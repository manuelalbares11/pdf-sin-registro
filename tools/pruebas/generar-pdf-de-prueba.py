import sys, zlib

def make(path, n, label, w=595, h=842, rotate=0):
    objs = {}
    font_id = 3 + 2*n
    kids = " ".join("%d 0 R" % (3 + 2*i) for i in range(n))
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>"
    objs[2] = "<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, n)
    for i in range(n):
        pid = 3 + 2*i; cid = pid + 1
        rot = " /Rotate %d" % rotate if rotate else ""
        objs[pid] = ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d]%s "
                     "/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
                     % (w, h, rot, font_id, cid))
        text = ("BT /F1 28 Tf 60 %d Td (%s - pagina %d) Tj ET\n"
                "BT /F1 12 Tf 60 %d Td (Documento de prueba generado localmente.) Tj ET\n"
                "1 0 0 RG 4 w 50 %d m %d %d l S\n" % (h-120, label, i+1, h-160, h-180, w-50, h-180))
        objs[cid] = None
        objs[str(cid)+"_stream"] = text
    objs[font_id] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    maxid = font_id
    for oid in range(1, maxid+1):
        offsets[oid] = len(out)
        if oid in objs and objs[oid] is not None:
            out += ("%d 0 obj\n%s\nendobj\n" % (oid, objs[oid])).encode("latin-1")
        else:
            data = objs[str(oid)+"_stream"].encode("latin-1")
            out += ("%d 0 obj\n<< /Length %d >>\nstream\n" % (oid, len(data))).encode("latin-1")
            out += data + b"\nendstream\nendobj\n"
    xref = len(out)
    out += ("xref\n0 %d\n" % (maxid+1)).encode()
    out += b"0000000000 65535 f \n"
    for oid in range(1, maxid+1):
        out += ("%010d 00000 n \n" % offsets[oid]).encode()
    out += ("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (maxid+1, xref)).encode()
    open(path, "wb").write(bytes(out))
    print(path, n, "paginas,", len(out), "bytes")

d = sys.argv[1]
make(d+"/doc-a.pdf", 3, "CONTRATO")
make(d+"/doc-b.pdf", 2, "ANEXO")
make(d+"/doc-c.pdf", 1, "ESCANEO", rotate=90)
