# Scripts de análisis de los Excel

Solo lectura. **Ninguno escribe en los archivos originales.**

Requiere `openpyxl`:
```bash
python3 -m venv venv && ./venv/bin/pip install openpyxl
```

| Script | Qué hace |
|---|---|
| `xlsx_dump.py <archivo>` | Estructura: hojas, dimensiones, primeras filas |
| `xlsx_full.py <archivo> [hoja] [filas]` | Volcado completo con fórmulas y valores |
| `xlsx_sheet.py <archivo> <hoja> [filas] [desde] [v]` | Una hoja, modo lectura rápida |
| `xlsx_meta.py <archivo>` | Rangos con nombre, tablas, validaciones |
| `base_stats.py <archivo> <hoja>` | Estadísticas por columna, valores distintos |
| `overlap.py` | Duplicados internos y cruce entre los dos libros de nómina |

Salidas guardadas del análisis del 2026-08-12:
`sky_base_stats.txt`, `inf_base_stats.txt`, `sky_listas.txt`, `comis_w29.txt`, `comis_desc.txt`.

Conclusiones en `docs/EXCEL_ANALYSIS.md`.
