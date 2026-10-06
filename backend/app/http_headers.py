from fastapi import Response


def no_store(response: Response) -> None:
    """Route dependency: keep a user's private data out of browser and proxy caches."""
    response.headers["Cache-Control"] = "no-store"
