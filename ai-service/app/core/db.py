"""PostgreSQL connection pool with pgvector support."""
from contextlib import contextmanager

from pgvector.psycopg import register_vector
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.core.config import get_settings

_pool: ConnectionPool | None = None


def _configure(conn):
    register_vector(conn)  # lets us pass numpy arrays / lists as VECTOR values


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            get_settings().database_url,
            min_size=1,
            max_size=8,
            configure=_configure,
            kwargs={"row_factory": dict_row},
            open=True,
        )
    return _pool


@contextmanager
def conn():
    with get_pool().connection() as c:
        yield c


def fetch_all(sql: str, params: tuple | dict = ()) -> list[dict]:
    with conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def fetch_one(sql: str, params: tuple | dict = ()) -> dict | None:
    with conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()
