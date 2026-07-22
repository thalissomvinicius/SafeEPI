import unittest

from safeepi_agent.security import ProtectedTokenStore, SecurityError, normalize_server_url


class FakeProtector:
    def protect(self, value: bytes) -> bytes:
        return bytes(byte ^ 0xA5 for byte in value)

    def unprotect(self, value: bytes) -> bytes:
        return bytes(byte ^ 0xA5 for byte in value)


class SecurityTests(unittest.TestCase):
    def test_requires_https_except_for_loopback_development(self):
        self.assertEqual(normalize_server_url("https://safe-epi.vercel.app/"), "https://safe-epi.vercel.app")
        self.assertEqual(normalize_server_url("http://127.0.0.1:3000"), "http://127.0.0.1:3000")
        with self.assertRaises(SecurityError):
            normalize_server_url("http://empresa.exemplo")

    def test_stores_terminal_token_only_in_protected_form(self):
        storage: dict[str, bytes] = {}
        token_store = ProtectedTokenStore(
            protector=FakeProtector(),
            read_bytes=lambda: storage.get("token"),
            write_bytes=lambda value: storage.__setitem__("token", value),
        )

        token = "safeepi-terminal-token-with-at-least-32-chars"
        token_store.save(token)

        self.assertNotIn(token.encode("utf-8"), storage["token"])
        self.assertEqual(token_store.load(), token)


if __name__ == "__main__":
    unittest.main()
