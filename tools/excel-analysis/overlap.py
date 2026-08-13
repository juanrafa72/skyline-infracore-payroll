import openpyxl
from collections import Counter
SKY="/Users/jrc/Documents/Documentos - MacBook Pro de Juan/FIBRA OPTICA/SKYLINE ADVANCE TECH/03 - RECURSOS HUMANOS/SEGUIMIENTO LABORAL/2026 Laboral/NOMINA 2026 AERIO&UG- v03-20 oct---.xlsx"
INF="/Users/jrc/Documents/Documentos - MacBook Pro de Juan/FIBRA OPTICA/INFRACORE SYSTEMS LLC/SEGUIMIENTO LABORAL - INFRACORE/NOMINA 2026 -INFRACORE-N-AGOSTO 9.xlsx"
def load(p):
    wb=openpyxl.load_workbook(p,read_only=True,data_only=True); ws=wb["BASE"]; out=[]; hdr=None
    for i,row in enumerate(ws.iter_rows(values_only=True)):
        if i==0:
            hdr=[str(v).strip() if v else "" for v in row]
            idx={k:hdr.index(k) for k in ["Nombre","Fecha","PAGO TOTAL","Día trabajados"]}
            continue
        if all(v is None for v in row): continue
        n=row[idx["Nombre"]]; f=row[idx["Fecha"]]
        if not n or not f: continue
        out.append((str(n).strip().upper(), str(f)[:10], row[idx["PAGO TOTAL"]], row[idx["Día trabajados"]]))
    wb.close(); return out
s=load(SKY); i=load(INF)
print("skyline rows w/ name+date:",len(s)," infracore:",len(i))
ks=Counter((a,b) for a,b,_,_ in s); ki=Counter((a,b) for a,b,_,_ in i)
dup_s=[(k,v) for k,v in ks.items() if v>1]
dup_i=[(k,v) for k,v in ki.items() if v>1]
print("DUPLICADOS internos Skyline (mismo nombre+fecha):",len(dup_s))
for k,v in dup_s[:15]: print("   ",k,v)
print("DUPLICADOS internos Infracore:",len(dup_i))
for k,v in dup_i[:15]: print("   ",k,v)
inter=set(ks)&set(ki)
print("CRUCE entre los dos archivos (mismo nombre+fecha):",len(inter))
for k in list(inter)[:15]: print("   ",k)
