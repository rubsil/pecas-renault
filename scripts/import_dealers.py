#!/usr/bin/env python3
"""
Importa a lista oficial de concessionários (data/dealers_page*.json)
para a tabela official_dealers da D1, via Wrangler.

Uso:
    python3 scripts/import_dealers.py

Gera um ficheiro SQL (data/import_dealers.sql) pronto a correr com:
    wrangler d1 execute peca-troca-db --file=data/import_dealers.sql --remote

Isto não corre a query diretamente porque a autenticação da D1 fica
do lado da máquina que tem o Wrangler ligado ao Cloudflare — gera-se
o SQL aqui, corre-se lá.
"""

import json
import re
import unicodedata
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(c for c in value if unicodedata.category(c) != "Mn")
    value = value.lower()
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def normalize_phone(value: str) -> str:
    # Mesma lógica do normalize.ts do worker — tem de convergir com ela,
    # ou a validação automática nunca vai encontrar match.
    digits = re.sub(r"\D+", "", value or "")
    if digits.startswith("00351"):
        digits = digits[5:]
    elif digits.startswith("351") and len(digits) > 9:
        digits = digits[3:]
    return digits


def sql_escape(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def main():
    dealer_files = sorted(DATA_DIR.glob("dealers_page*.json"))
    if not dealer_files:
        print(f"Nenhum ficheiro dealers_page*.json encontrado em {DATA_DIR}")
        return

    all_dealers = []
    for file in dealer_files:
        with open(file, encoding="utf-8") as f:
            payload = json.load(f)
        source_url = payload.get("source_url", "")
        for d in payload.get("dealers", []):
            all_dealers.append({**d, "source_url": source_url})

    print(f"Total de concessionários a importar: {len(all_dealers)}")

    lines = ["-- Importação automática da lista oficial de concessionários Renault", ""]
    for d in all_dealers:
        name = d["company_name"]
        name_norm = normalize_text(name)
        phone = d.get("phone", "")
        phone_norm = normalize_phone(phone)

        lines.append(
            "INSERT INTO official_dealers "
            "(company_name, company_name_normalized, address, postal_code, city, phone, phone_normalized, source_url) "
            "VALUES ("
            f"{sql_escape(name)}, {sql_escape(name_norm)}, {sql_escape(d.get('address'))}, "
            f"{sql_escape(d.get('postal_code'))}, {sql_escape(d.get('city'))}, "
            f"{sql_escape(phone)}, {sql_escape(phone_norm)}, {sql_escape(d.get('source_url'))}"
            ");"
        )

    output_path = DATA_DIR / "import_dealers.sql"
    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"SQL gerado em: {output_path}")
    print("\nPróximo passo:")
    print("  wrangler d1 execute peca-troca-db --file=data/import_dealers.sql --remote")


if __name__ == "__main__":
    main()
