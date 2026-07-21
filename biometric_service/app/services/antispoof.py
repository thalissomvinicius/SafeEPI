import numpy as np


class PassiveAntiSpoof:
    """Fail-closed plug point for a future certified anti-spoof model.

    Qualidade de imagem nao prova presenca. Enquanto um modelo real nao estiver
    configurado, o score de liveness permanece zero e o fluxo usa o fallback
    auditavel da aplicacao.
    """

    available = False

    def score(self, image: np.ndarray, face_bbox: list[float], quality: float) -> float:
        del image, face_bbox, quality
        return 0.0


antispoof = PassiveAntiSpoof()
