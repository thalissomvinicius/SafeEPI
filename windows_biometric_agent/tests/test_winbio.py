import unittest
import uuid

from safeepi_agent.winbio import Guid, WinBioIdentity, describe_hresult


class WinBioInteropTests(unittest.TestCase):
    def test_guid_round_trip_preserves_employee_identifier(self):
        employee_id = uuid.UUID("73e9dc33-7ff1-4fda-b65d-a1684cfb4b90")

        native = Guid.from_uuid(employee_id)

        self.assertEqual(native.to_uuid(), employee_id)

    def test_employee_identity_uses_the_windows_guid_discriminator(self):
        identity = WinBioIdentity.for_template(uuid.uuid4())

        self.assertEqual(identity.Type, 2)

    def test_maps_capture_errors_to_operator_friendly_messages(self):
        self.assertEqual(describe_hresult(0x80098008), "Leitura ruim. Posicione o dedo novamente.")
        self.assertEqual(describe_hresult(0x80098005), "Digital não cadastrada neste terminal.")


if __name__ == "__main__":
    unittest.main()
