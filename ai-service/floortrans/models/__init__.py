from floortrans.models.hg_furukawa_original import hg_furukawa_original


def get_model(name, n_classes=None, version=None):
    if name != "hg_furukawa_original":
        raise ValueError("Model {} not available".format(name))
    return hg_furukawa_original(n_classes=n_classes)
