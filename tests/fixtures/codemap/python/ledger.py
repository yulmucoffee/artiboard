"""Ledger entries for the billing service.

The module keeps no state at import time apart from the cache below.
"""

from __future__ import annotations

import json
import os.path
import decimal as dec
from .money import Money, parse_money
from ..shared.errors import (
    LedgerError,  # raised for unknown accounts
    Overdraft,
)
from ..shared import util

# def retired_helper(entry):
#     return entry
#
# class Legacy(Base):
#     pass

MAX_ENTRIES = 500
DEFAULT_CURRENCY = "EUR"
SEPARATOR = "#"
_cache = {}
note = "class Ghost(Base): def phantom(): pass"


def parse_entry(raw):
    """Turn a dict into an Entry. Mentions class Ghost and def phantom()."""
    amount = parse_money(raw["amount"])
    return Entry(amount, raw.get("memo", ""))


@util.cached
async def load_entries(path):
    with open(path, "r") as handle:
        rows = [json.loads(line) for line in handle]
    return [parse_entry(row) for row in rows][:MAX_ENTRIES]


class Entry(Money):
    KIND = "entry"

    def __init__(self, amount, memo=""):
        super().__init__(amount)
        self.memo = memo

    @property
    def signed(self):
        sign = -1 if self.memo.startswith("refund") else 1
        return sign * self.cents

    def _audit(self):
        return f"{self.memo!r} {self.cents}"

    @staticmethod
    def blank():
        return Entry(Money(0), "")


class Ledger(Entry, util.Mixin):
    def post(self, entry):
        if entry.signed < 0 and not self.allow_negative:
            raise Overdraft(entry)
        self.items.append(entry)
        return dec.Decimal(entry.cents)

    def total(self):
        return sum(item.signed for item in self.items)

    def describe(self):
        def label(item):
            return str(item)
        return [label(i) for i in self.items]


def build_default(path=os.path.join("data", "ledger.json")):
    ledger = Ledger(DEFAULT_CURRENCY)
    ledger.post(parse_entry({"amount": "0"}))
    return ledger


if __name__ == "__main__":
    print(build_default().total())
