from __future__ import annotations

import platform
import queue
import threading
import tkinter as tk
from dataclasses import dataclass
from tkinter import messagebox, ttk
from typing import Callable

from . import __version__
from .api import AgentApi, AgentApiError
from .config import ConfigRepository, TerminalConfig
from .models import FingerprintCommand
from .security import SecurityError
from .winbio import BiometricUnit, WinBioClient, WinBioError


@dataclass(slots=True)
class UiEvent:
    kind: str
    message: str


class SafeEpiFingerprintApp:
    def __init__(
        self,
        root: tk.Tk,
        config_repository: ConfigRepository | None = None,
        winbio_factory: Callable[[], WinBioClient] = WinBioClient,
    ) -> None:
        self.root = root
        self.config_repository = config_repository or ConfigRepository()
        self.winbio_factory = winbio_factory
        self.config = self.config_repository.load()
        self.token = self.config_repository.load_token()
        self.identity_store = self.config_repository.identity_store
        self.stop_event = threading.Event()
        self.worker: threading.Thread | None = None
        self.ui_events: queue.Queue[UiEvent] = queue.Queue()
        self.current_command: FingerprintCommand | None = None
        self._build_window()
        self.root.after(150, self._drain_events)
        if self.token and self.config.terminal_id:
            self._show_terminal_view()
            self._start_polling()
        else:
            self._show_pairing_view()

    def _build_window(self) -> None:
        self.root.title("SafeEPI Leitor Digital")
        self.root.geometry("680x520")
        self.root.minsize(600, 470)
        self.root.configure(bg="#f8fafc")
        self.root.protocol("WM_DELETE_WINDOW", self.close)

        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Primary.TButton", background="#b01924", foreground="white", padding=12, font=("Segoe UI", 10, "bold"))
        style.map("Primary.TButton", background=[("active", "#8f151e")])
        style.configure("Secondary.TButton", padding=10, font=("Segoe UI", 9, "bold"))

        self.header = tk.Frame(self.root, bg="#111827", height=88)
        self.header.pack(fill="x")
        self.header.pack_propagate(False)
        tk.Label(self.header, text="SAFEEPI", bg="#111827", fg="white", font=("Segoe UI", 21, "bold")).pack(anchor="w", padx=28, pady=(16, 0))
        tk.Label(self.header, text="TERMINAL DE CONFIRMAÇÃO POR IMPRESSÃO DIGITAL", bg="#111827", fg="#cbd5e1", font=("Segoe UI", 9, "bold")).pack(anchor="w", padx=29)

        self.content = tk.Frame(self.root, bg="#f8fafc")
        self.content.pack(fill="both", expand=True, padx=30, pady=24)

    def _clear_content(self) -> None:
        for child in self.content.winfo_children():
            child.destroy()

    def _show_pairing_view(self) -> None:
        self._clear_content()
        tk.Label(self.content, text="VINCULAR ESTE COMPUTADOR", bg="#f8fafc", fg="#0f172a", font=("Segoe UI", 17, "bold")).pack(anchor="w")
        tk.Label(
            self.content,
            text="No SafeEPI, abra Configuração do leitor e gere um código de pareamento. O código vale por 10 minutos.",
            bg="#f8fafc",
            fg="#475569",
            wraplength=590,
            justify="left",
            font=("Segoe UI", 10),
        ).pack(anchor="w", pady=(8, 20))

        tk.Label(self.content, text="ENDEREÇO DO SAFEEPI", bg="#f8fafc", fg="#64748b", font=("Segoe UI", 8, "bold")).pack(anchor="w")
        self.server_entry = ttk.Entry(self.content, font=("Segoe UI", 10))
        self.server_entry.insert(0, self.config.server_url)
        self.server_entry.pack(fill="x", pady=(5, 14), ipady=8)

        tk.Label(self.content, text="CÓDIGO DE PAREAMENTO", bg="#f8fafc", fg="#64748b", font=("Segoe UI", 8, "bold")).pack(anchor="w")
        self.code_entry = ttk.Entry(self.content, font=("Consolas", 17, "bold"), justify="center")
        self.code_entry.pack(fill="x", pady=(5, 18), ipady=10)
        self.code_entry.focus_set()

        self.pair_button = ttk.Button(self.content, text="VINCULAR TERMINAL", style="Primary.TButton", command=self._pair)
        self.pair_button.pack(fill="x")
        self.pair_status = tk.Label(self.content, text="", bg="#f8fafc", fg="#b01924", font=("Segoe UI", 9, "bold"))
        self.pair_status.pack(pady=14)

    def _pair(self) -> None:
        code = self.code_entry.get().strip()
        server_url = self.server_entry.get().strip()
        if len(code.replace("-", "")) < 9:
            self.pair_status.configure(text="Informe o código completo.")
            return
        self.pair_button.configure(state="disabled")
        self.pair_status.configure(text="Verificando leitor e pareamento...")

        def work() -> None:
            try:
                winbio = self.winbio_factory()
                units = winbio.units()
                if not units:
                    raise RuntimeError("Nenhum leitor biométrico foi encontrado pelo Windows.")
                unit = units[0]
                api = AgentApi(server_url)
                result = api.pair({
                    "code": code,
                    "device_id": self.config.device_id,
                    "device_instance_id": unit.device_instance_id,
                    "device_description": unit.description,
                    "app_version": __version__,
                    "os_version": platform.platform(),
                    "current_company_id": self.config.company_id,
                })
                self.config = TerminalConfig(
                    server_url=api.server_url,
                    device_id=self.config.device_id,
                    terminal_id=result.terminal_id,
                    company_id=result.company_id,
                    terminal_name=result.terminal_name,
                    poll_interval_seconds=result.poll_interval_seconds,
                )
                self.config_repository.save(self.config)
                self.config_repository.save_token(result.terminal_token)
                self.token = result.terminal_token
                self.ui_events.put(UiEvent("paired", "Terminal vinculado com sucesso."))
            except (AgentApiError, WinBioError, RuntimeError, ValueError) as error:
                self.ui_events.put(UiEvent("pair_error", str(error)))

        threading.Thread(target=work, daemon=True, name="safeepi-pair").start()

    def _show_terminal_view(self) -> None:
        self._clear_content()
        top = tk.Frame(self.content, bg="#f8fafc")
        top.pack(fill="x")
        tk.Label(top, text=self.config.terminal_name or "TERMINAL SAFEEPI", bg="#f8fafc", fg="#0f172a", font=("Segoe UI", 17, "bold")).pack(anchor="w")
        self.connection_label = tk.Label(top, text="● CONECTANDO", bg="#f8fafc", fg="#d97706", font=("Segoe UI", 9, "bold"))
        self.connection_label.pack(anchor="w", pady=(4, 0))

        card = tk.Frame(self.content, bg="white", highlightbackground="#e2e8f0", highlightthickness=1)
        card.pack(fill="both", expand=True, pady=22)
        self.action_label = tk.Label(card, text="AGUARDANDO COMANDO", bg="white", fg="#64748b", font=("Segoe UI", 10, "bold"))
        self.action_label.pack(pady=(45, 10))
        self.employee_label = tk.Label(card, text="Abra uma entrega ou cadastro no SafeEPI", bg="white", fg="#0f172a", wraplength=520, font=("Segoe UI", 18, "bold"))
        self.employee_label.pack(padx=24)
        self.instruction_label = tk.Label(card, text="O leitor será ativado automaticamente.", bg="white", fg="#64748b", wraplength=520, font=("Segoe UI", 10))
        self.instruction_label.pack(pady=(12, 24), padx=24)
        self.sensor_label = tk.Label(card, text="", bg="white", fg="#b01924", font=("Segoe UI", 10, "bold"))
        self.sensor_label.pack(pady=8)

        ttk.Button(self.content, text="TESTAR LEITOR", style="Secondary.TButton", command=self._test_sensor).pack(side="left")
        tk.Label(self.content, text=f"Versão {__version__}", bg="#f8fafc", fg="#94a3b8", font=("Segoe UI", 8)).pack(side="right")

    def _start_polling(self) -> None:
        if self.worker and self.worker.is_alive():
            return
        self.stop_event.clear()
        self.worker = threading.Thread(target=self._poll_loop, daemon=True, name="safeepi-poll")
        self.worker.start()

    def _poll_loop(self) -> None:
        assert self.token is not None
        api = AgentApi(self.config.server_url)
        interval = self.config.poll_interval_seconds
        while not self.stop_event.is_set():
            try:
                command = api.next_command(self.token)
                self.ui_events.put(UiEvent("online", "Conectado ao SafeEPI"))
                if command:
                    self.current_command = command
                    self.ui_events.put(UiEvent("command", f"{command.operation}|{command.employee_name}"))
                    result = self._execute_command(command)
                    response = api.complete(self.token, command, result)
                    if response.get("ok"):
                        self.ui_events.put(UiEvent("success", "Confirmação biométrica concluída."))
                    else:
                        self.ui_events.put(UiEvent("failure", "A digital não foi confirmada."))
                    self.current_command = None
            except AgentApiError as error:
                if error.status == 401:
                    self.config_repository.clear_terminal_token()
                    self.token = None
                    self.ui_events.put(UiEvent("revoked", "Este terminal foi revogado. Gere um novo código de pareamento."))
                    break
                self.ui_events.put(UiEvent("offline", str(error)))
            except (WinBioError, RuntimeError, ValueError) as error:
                self.ui_events.put(UiEvent("offline", str(error)))
            self.stop_event.wait(interval)

    def _execute_command(self, command: FingerprintCommand) -> dict[str, object]:
        cached = self.identity_store.get_command_result(command.id)
        if cached is not None:
            return cached

        try:
            winbio = self.winbio_factory()
            units = winbio.units()
            if not units:
                raise RuntimeError("Leitor biométrico não encontrado.")
            unit: BiometricUnit = units[0]
            if command.operation == "enroll":
                if self.identity_store.get_enrollment(command.employee_id):
                    result = command.result_payload(success=False, error_code="already_enrolled_local")
                else:
                    enrollment = winbio.enroll(unit.unit_id)
                    try:
                        self.identity_store.save_enrollment(
                            command.employee_id,
                            enrollment.template_id,
                            enrollment.unit_id,
                        )
                    except SecurityError:
                        winbio.delete(enrollment.template_id, enrollment.unit_id)
                        raise
                    result = command.result_payload(success=True, unit_id=enrollment.unit_id)
            elif command.operation == "verify":
                enrollment = self.identity_store.get_enrollment(command.employee_id)
                if not enrollment:
                    result = command.result_payload(success=False, error_code="not_enrolled_local")
                else:
                    used_unit = winbio.verify(enrollment.template_id, unit.unit_id)
                    result = command.result_payload(success=True, unit_id=used_unit)
            else:
                enrollment = self.identity_store.get_enrollment(command.employee_id)
                if enrollment:
                    used_unit = winbio.delete(enrollment.template_id, unit.unit_id)
                    self.identity_store.remove_enrollment(command.employee_id)
                    result = command.result_payload(success=True, unit_id=used_unit)
                else:
                    result = command.result_payload(success=True, unit_id=unit.unit_id)
        except WinBioError as error:
            result = command.result_payload(
                success=False,
                error_code=f"winbio_0x{error.hresult:08x}",
                reject_detail=error.reject_detail,
            )
        except SecurityError:
            result = command.result_payload(success=False, error_code="local_identity_store_unavailable")
        except RuntimeError:
            result = command.result_payload(success=False, error_code="sensor_unavailable")

        self.identity_store.cache_command_result(command.id, result)
        return result

    def _test_sensor(self) -> None:
        def work() -> None:
            try:
                units = self.winbio_factory().units()
                message = f"Leitor pronto: {units[0].description}" if units else "Nenhum leitor encontrado."
                self.ui_events.put(UiEvent("sensor", message))
            except (WinBioError, RuntimeError) as error:
                self.ui_events.put(UiEvent("sensor", str(error)))
        threading.Thread(target=work, daemon=True, name="safeepi-sensor-test").start()

    def _drain_events(self) -> None:
        while True:
            try:
                event = self.ui_events.get_nowait()
            except queue.Empty:
                break
            if event.kind == "paired":
                self._show_terminal_view()
                self._start_polling()
                messagebox.showinfo("SafeEPI", event.message)
            elif event.kind == "pair_error":
                self.pair_button.configure(state="normal")
                self.pair_status.configure(text=event.message)
            elif event.kind == "online":
                self.connection_label.configure(text="● ONLINE", fg="#059669")
            elif event.kind == "offline":
                self.connection_label.configure(text="● RECONECTANDO", fg="#d97706")
                self.sensor_label.configure(text=event.message)
            elif event.kind == "revoked":
                self._show_pairing_view()
                self.pair_status.configure(text=event.message)
            elif event.kind == "command":
                operation, employee_name = event.message.split("|", 1)
                labels = {"enroll": "CADASTRO DE DIGITAL", "verify": "CONFIRMAÇÃO DE ENTREGA", "delete": "REMOÇÃO DE DIGITAL"}
                self.action_label.configure(text=labels.get(operation, "LEITURA DIGITAL"), fg="#b01924")
                self.employee_label.configure(text=employee_name)
                instruction = "Encoste e retire o dedo conforme o leitor solicitar." if operation == "enroll" else "Coloque o dedo indicador direito no leitor."
                self.instruction_label.configure(text=instruction)
                self.sensor_label.configure(text="Aguardando o dedo...")
            elif event.kind in {"success", "failure"}:
                self.sensor_label.configure(text=event.message, fg="#059669" if event.kind == "success" else "#dc2626")
                self.root.after(3500, self._reset_waiting_view)
            elif event.kind == "sensor":
                self.sensor_label.configure(text=event.message)
        self.root.after(150, self._drain_events)

    def _reset_waiting_view(self) -> None:
        if self.current_command is not None:
            return
        self.action_label.configure(text="AGUARDANDO COMANDO", fg="#64748b")
        self.employee_label.configure(text="Abra uma entrega ou cadastro no SafeEPI")
        self.instruction_label.configure(text="O leitor será ativado automaticamente.")
        self.sensor_label.configure(text="", fg="#b01924")

    def close(self) -> None:
        self.stop_event.set()
        self.root.destroy()


def run() -> None:
    root = tk.Tk()
    SafeEpiFingerprintApp(root)
    root.mainloop()
