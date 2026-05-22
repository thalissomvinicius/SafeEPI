import numpy as np


class PassiveAntiSpoof:
    """Plug point for MiniFASNet/SilentFace.

    A producao deve carregar o modelo anti-spoof aqui. A heuristica abaixo e
    propositalmente conservadora para manter o contrato funcional em dev.
    """

    def score(self, image: np.ndarray, face_bbox: list[float], quality: float) -> float:
        # Placeholder calibrado para dev: qualidade muito ruim reduz live score.
        # Substituir por MiniFASNet/SilentFace no deploy biometrico.
        return max(0.25, min(0.98, 0.62 + quality * 0.34))


antispoof = PassiveAntiSpoof()
