import unittest
import uuid

from safeepi_agent.identity_store import BiometricIdentityStore


class FakeProtector:
    def protect(self, value: bytes) -> bytes:
        return bytes(byte ^ 0xA5 for byte in value)

    def unprotect(self, value: bytes) -> bytes:
        return bytes(byte ^ 0xA5 for byte in value)


class BiometricIdentityStoreTests(unittest.TestCase):
    def test_keeps_only_an_encrypted_local_reference_to_the_windows_template(self):
        storage: dict[str, bytes] = {}
        store = BiometricIdentityStore(
            protector=FakeProtector(),
            read_bytes=lambda: storage.get("state"),
            write_bytes=lambda value: storage.__setitem__("state", value),
        )
        employee_id = uuid.uuid4()
        template_id = uuid.uuid4()

        store.save_enrollment(employee_id, template_id, 3)

        self.assertNotIn(str(employee_id).encode(), storage["state"])
        enrollment = store.get_enrollment(employee_id)
        self.assertIsNotNone(enrollment)
        self.assertEqual(enrollment.template_id, template_id)
        self.assertEqual(enrollment.unit_id, 3)

    def test_caches_command_results_to_avoid_repeating_a_hardware_operation(self):
        storage: dict[str, bytes] = {}
        store = BiometricIdentityStore(
            protector=FakeProtector(),
            read_bytes=lambda: storage.get("state"),
            write_bytes=lambda value: storage.__setitem__("state", value),
        )
        command_id = uuid.uuid4()
        result = {"success": True, "unit_id": 1, "error_code": None, "reject_detail": None}

        store.cache_command_result(command_id, result)

        self.assertEqual(store.get_command_result(command_id), result)


if __name__ == "__main__":
    unittest.main()
