"""List-size caps shared by the routes that can grow a person's lists."""

MAX_HOLDINGS = 100


def cap_message(what: str, cap: int) -> str:
    return f"You can keep up to {cap} {what}. Remove one before adding another."
