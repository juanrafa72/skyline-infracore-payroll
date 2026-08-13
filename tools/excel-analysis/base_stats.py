import sys, openpyxl
from collections import Counter, defaultdict
path, sheet = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
ws = wb[sheet]
rows = ws.iter_rows(values_only=True)
hdr = None
# find header row: the one containing 'Nombre'
buf = []
for i, row in enumerate(rows):
    vals = [str(v) if v is not None else "" for v in row]
    if hdr is None:
        if any(v.strip() == "Nombre" for v in vals):
            hdr = [v.strip() for v in vals]
            hdr_idx = i
            print("HEADER row %d: %s" % (i+1, hdr))
            continue
        if i > 20:
            print("no header found in first 20 rows"); break
        continue
    if all(v == "" for v in vals):
        continue
    buf.append(row)
print("DATA ROWS:", len(buf))
cols = {name: k for k, name in enumerate(hdr) if name}
counters = defaultdict(Counter)
numeric = defaultdict(list)
INTEREST = ["Tipo","Nombre","Día trabajados","Observ Trabaj","Adicionales","Corte","Valor Día",
            "Valor adicional","Dctos","Observación Dctos","PAGO TOTAL","AÑO","PROYECTOS","EMPRESA",
            "EQUIPO","HORAS","PAYROLL","Día semana","Mes","DAYS","WEEK","CONTRATISTA"]
for row in buf:
    for name, k in cols.items():
        if name not in INTEREST or k >= len(row):
            continue
        v = row[k]
        if v is None:
            counters[name]["<blank>"] += 1
        elif isinstance(v, (int, float)):
            numeric[name].append(v)
            counters[name]["<num>"] += 1
        else:
            counters[name][str(v).strip()[:45]] += 1
for name in INTEREST:
    if name not in counters:
        continue
    c = counters[name]
    print("\n## %s  (distinct=%d)" % (name, len(c)))
    for v, n in c.most_common(45):
        print("   %6d  %s" % (n, v))
    if numeric[name]:
        nums = numeric[name]
        print("   NUM: n=%d min=%s max=%s sum=%.2f" % (len(nums), min(nums), max(nums), sum(nums)))
wb.close()
