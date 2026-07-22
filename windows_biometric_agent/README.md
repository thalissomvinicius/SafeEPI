# SafeEPI Leitor para Windows

Aplicativo do terminal fixo que usa o Windows Biometric Framework (WBF) para cadastrar e confirmar colaboradores por impressão digital.

## Princípios de segurança

- A imagem, amostra e o template da digital nunca são enviados ao SafeEPI ou ao Supabase.
- O template permanece no banco privado administrado pelo Windows no computador da empresa.
- O GUID opaco devolvido pelo WBF é associado ao colaborador somente em um mapa local protegido por DPAPI; ele não é enviado ao Supabase.
- O aplicativo recebe somente comandos de curta duração vinculados à empresa, ao terminal e ao colaborador.
- A credencial do terminal é armazenada com DPAPI e nunca aparece no arquivo `config.json`.
- Cada confirmação gera um evento com hash, horário, terminal e identificador de evidência.

## Desenvolvimento

```powershell
$env:PYTHONPATH="$PWD"
python -m unittest discover -s tests -v
python -m safeepi_agent
```

## Gerar o executável

```powershell
.\build.ps1
```

O resultado fica em `dist\SafeEPI-Leitor.exe`.

## Instalação no terminal

1. Execute `installer\install.ps1` como Administrador.
2. No SafeEPI, gere o código de pareamento do terminal.
3. Informe o código no aplicativo.
4. Cadastre o indicador direito de cada colaborador pela tela de colaboradores.

O leitor precisa aparecer no Gerenciador de Dispositivos e permitir uma sessão WBF de pool privado. A simples detecção USB ou o funcionamento no Windows Hello não são suficientes: o instalador executa uma sessão real e interrompe a instalação se o driver for incompatível.

### Leitor FP100 / ChipSailing deste terminal

O dispositivo `USB\VID_2541&PID_0236`, com o driver ChipSailing `18.28.18.814`, funciona como leitor do Windows Hello, mas recusou a configuração e a abertura do pool privado exigido para identificar colaboradores do SafeEPI (`0x80098033`/`0x80070057`). O manual também documenta apenas Windows Hello e não fornece SDK de integração. Portanto, este exemplar não pode ser usado com segurança para identificar vários colaboradores no aplicativo. Será necessário um leitor cujo fabricante forneça SDK para Windows ou que passe no teste WBF de pool privado.

O instalador registra uma configuração WBF privada usando o banco `{E5975B98-141F-4D9C-BB5A-D1F62A1DFA44}`. A remoção é reversível por `installer\uninstall.ps1` e não exclui o banco padrão do Windows Hello.
