import unittest
from datetime import datetime, timedelta, timezone

from safeepi_agent.models import FingerprintCommand, ProtocolError


class FingerprintCommandTests(unittest.TestCase):
    @staticmethod
    def future_expiry() -> str:
        return (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")

    def test_parses_supported_command_without_biometric_payload(self):
        command = FingerprintCommand.from_payload(
            {
                "id": "ac4aa3d2-8ea7-47da-a2fe-c86423ce83e5",
                "operation": "verify",
                "employee_id": "4f5ea79d-d833-493f-baad-dd3d0c3e39aa",
                "employee_name": "MARIA DA SILVA",
                "expires_at": self.future_expiry(),
            }
        )

        self.assertEqual(command.operation, "verify")
        self.assertEqual(command.employee_name, "MARIA DA SILVA")
        self.assertNotIn("template", command.result_payload(success=True, unit_id=3))
        self.assertNotIn("image", command.result_payload(success=True, unit_id=3))

    def test_rejects_unknown_operations_and_invalid_identifiers(self):
        with self.assertRaises(ProtocolError):
            FingerprintCommand.from_payload(
                {
                    "id": "not-a-uuid",
                    "operation": "capture_raw",
                    "employee_id": "also-invalid",
                    "employee_name": "TESTE",
                    "expires_at": self.future_expiry(),
                }
            )


if __name__ == "__main__":
    unittest.main()
