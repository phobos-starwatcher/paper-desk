"""Render PDF pixels and align selectable glyphs across translated page layouts."""

import json
import re
import sys
import math
import unicodedata
from base64 import b64encode
from difflib import SequenceMatcher
from pathlib import Path

import pymupdf as fitz


MAX_PAGES = 400
SENTENCE_END = re.compile(r'[。！？!?]+[”’」』）】"\)]*|\.+[”’"\)]*(?=\s|$)')
ABBREV = re.compile(
    r"(?:\b(?:figs?|eqs?|refs?|secs?|vol|no|dr|vs|etc|approx|cf|mr|mrs|ms|prof|st)\.|"
    r"\b(?:et\s*al|i\.e|e\.g)\.|(?<![\w\-‐‑–—])\b[A-Za-z]\.)$", re.I
)
HAN = re.compile(r"[\u3400-\u9fff]")
NUMBERS = re.compile(r"(?<![\w.])\d+(?:\.\d+)?")
IDENTIFIERS = re.compile(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*")
# BabelDOC embeds some layout spaces with a U+0001 mapping.
LAYOUT_CONTROLS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def sentences(line_rows):
    text, refs = [], []
    for ln, row in enumerate(line_rows):
        # A layout wrap does not add a space between Chinese characters.
        if ln and not (HAN.search(text[-1]) and HAN.search(row[0][0])):
            text.append(" ")
            refs.append(None)
        for idx, glyph in enumerate(row):
            text.extend(glyph[0])
            refs.extend([(ln, idx)] * len(glyph[0]))
    joined = "".join(text)
    start = 0
    groups = []
    for match in SENTENCE_END.finditer(joined):
        if match[0].startswith(".") and ABBREV.search(joined[:match.start() + 1]):
            continue
        if match[0].startswith(".") and re.match(r"^(?:Figure|Table|图|表)\s*\d+\s*$", joined[start:match.start()].strip(), re.I):
            continue
        if match[0].startswith(".") and re.fullmatch(r"\s*\d+(?:\.\d+)*",joined[start:match.start()]):
            continue
        stop = match.end()
        if joined[start:stop].strip():
            groups.append((joined[start:stop].strip(), [ref for ref in refs[start:stop] if ref]))
        start = stop
    if joined[start:].strip():
        groups.append((joined[start:].strip(), [ref for ref in refs[start:] if ref]))
    return groups


def rectangle(box, page):
    return fitz.Rect(box) * page.rotation_matrix


def extract(page, show_pixels):
    w, h = page.rect.width, page.rect.height
    if w <= 0 or h <= 0:
        raise ValueError("PDF 页面尺寸无效。")
    blocks = []
    raw = page.get_text("rawdict", flags=fitz.TEXTFLAGS_RAWDICT & ~fitz.TEXT_PRESERVE_IMAGES)
    for b in raw["blocks"]:
        rows = []
        for line in b.get("lines", []):
            chars = []
            for span in line["spans"]:
                for ch in span["chars"]:
                    r = rectangle(ch["bbox"], page)
                    if r.width > 0 and r.height > 0:
                        chars.append([LAYOUT_CONTROLS.sub(" ", ch["c"]), round(r.x0 / w, 5), round(r.y0 / h, 5),
                                      round(r.width / w, 5), round(r.height / h, 5), None])
            if chars:
                rows.append(chars)
        if rows:
            r = rectangle(b["bbox"], page)
            block = {"box": [r.x0 / w, r.y0 / h, r.x1 / w, r.y1 / h], "rows": rows}
            # Extraction sometimes emits a separate block for every wrapped line.
            # Join adjacent rows at the same column origin before segmenting sentences.
            previous = blocks[-1] if blocks and page.rotation == 0 else None
            if previous:
                px, py, pr, pb = previous["box"]
                x, y, right, bottom = block["box"]
                last = previous["rows"][-1]
                first_height, prev_height = rows[0][0][4], last[0][4]
                gap = y - pb
                tail = "".join(g[0] for g in last).rstrip()
                if (abs(px - x) < .013 and abs(first_height - prev_height) < .22 * prev_height
                        and -.15 * prev_height < gap < .46 * prev_height and
                        not (tail.endswith((".", "。", "？", "！", "?", "!")) and
                             last[-1][1] - px < max(.03, .72*(pr-px)))):
                    previous["box"] = [min(px, x), py, max(pr, right), max(pb, bottom)]
                    previous["rows"].extend(rows)
                    continue
            blocks.append(block)
    data = {"width": round(w, 2), "height": round(h, 2), "blocks": blocks}
    if show_pixels:
        zoom = min(2.35, 1650 / max(w, h))
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csRGB, alpha=False)
        data["image"] = "data:image/jpeg;base64," + b64encode(pix.tobytes("jpeg", jpg_quality=88)).decode("ascii")
    return data


def overlaps(a, b):
    """Pair regions across a page without crossing the gutter or adjoining headings."""
    ax, ay, ar, ab = a["box"]
    bx, by, br, bb = b["box"]
    if (max(ar-ax,br-bx) > .64 and min(ar-ax,br-bx) < .48
            and abs(ay-by) > .010 and min(ax,bx)<.28):
        return False
    x_overlap = (min(ar, br) - max(ax, bx)) / max(.001, min(ar-ax, br-bx))
    y_overlap = (min(ab, bb) - max(ay, by)) / max(.001, min(ab-ay, bb-by))
    return x_overlap >= .52 and (y_overlap >= .32 or (abs(ay-by) < .008 and y_overlap > -.12))


def regions(a,b):
    """Take connected components of overlapping source and target regions."""
    graph = [[] for _ in range(len(a)+len(b))]
    offset=len(a)
    for i, src in enumerate(a):
        for j, dst in enumerate(b):
            if overlaps(src,dst):
                graph[i].append(offset+j)
                graph[offset+j].append(i)
    seen=set()
    for i in range(offset):
        if i in seen or not graph[i]:
            continue
        pending=[i]
        seen.add(i)
        group=[[],[]]
        while pending:
            j=pending.pop()
            if j<offset: group[0].append(a[j])
            else: group[1].append(b[j-offset])
            for k in graph[j]:
                if k not in seen:
                    seen.add(k)
                    pending.append(k)
        yield group


def features(text):
    folded=unicodedata.normalize("NFKC",text).translate(str.maketrans("−‐‑–—","-----"))
    ids={token.lower() for token in IDENTIFIERS.findall(folded)
         if len(token)>=3 and (any(c.isdigit() for c in token) and any(c.isalpha() for c in token)
                              or len(token)>=4 and token.isupper())}
    return set(NUMBERS.findall(folded)),ids


def flow(blocks):
    # PDF extraction may divide a single sentence among unrelated text objects.
    # Reconstruct each connected region in physical reading order before splitting.
    rows=[row for block in blocks for row in block["rows"]]
    rows.sort(key=lambda row:(round(min(g[2]+.55*g[4] for g in row),3),row[0][1]))
    grouped=[]
    for text,refs in sentences(rows):
        glyphs=[rows[row][col] for row,col in refs]
        if not glyphs or not text.strip():
            continue
        ys=[g[2]+.55*g[4] for g in glyphs if g[0].strip()]
        if not ys: continue
        digits,ids=features(text)
        grouped.append((text,glyphs,min(ys),max(ys),len(re.sub(r"\s","",text)),digits,ids))
    return grouped


def segments(flow_rows):
    result={}
    for i in range(len(flow_rows)):
        for count in (1,2,3):
            if i+count > len(flow_rows):break
            rows=flow_rows[i:i+count]
            text=" ".join(r[0] for r in rows)
            plain="".join(c for c in unicodedata.normalize("NFKC",text).casefold() if c.isalnum())
            result[i,count]=(text,
                             min(r[2] for r in rows),max(r[3] for r in rows),
                             sum(r[4] for r in rows),
                             set().union(*(r[5] for r in rows)),set().union(*(r[6] for r in rows)),plain)
    return result


def match_cost(src,dst,ratio,counts):
    en,a0,a1,an,na,ia,ac=src
    zh,b0,b1,bn,nb,ib,bc=dst
    steps=.78*(sum(counts)-2)
    if en.casefold()==zh.casefold() or (len(ac)>=3 and ac==bc):
        return -.6 + 7*abs(a0-b0)+steps
    position=abs(a0-b0)*.65+abs(a1-b1)*.35
    gap=max(0,max(a0,b0)-min(a1,b1))
    if gap > .12:
        return 8
    if not HAN.search(zh):
        if min(len(ac),len(bc))>=12 and min(len(ac),len(bc))/max(len(ac),len(bc))>=.68 and position<.062:
            similarity=SequenceMatcher(None,ac,bc,autojunk=True).ratio()
            if similarity>=.74:
                return 5*position+.6*(1-similarity)+steps
        return 4.5
    length=.48*abs(math.log((bn+4)/(an*ratio+4)))
    anchor=.22*min(4,len(na.symmetric_difference(nb))) + .23*min(3,len(ia.symmetric_difference(ib)))
    anchor-=.34*min(4,len(na&nb)+len(ia&ib))
    return max(-.6,.32+10*position+4*gap+length+anchor)+steps


def align_flow(src,dst):
    # Monotonic alignment with split/merge transitions and optional gaps.
    # Keeping a sentence skipped is cheaper than assigning distant or untranslated text.
    n,m=len(src),len(dst)
    if not n or not m or n*m>40000:
        return []
    ratio=max(.23,min(1.4,sum(r[4] for r in dst)/sum(r[4] for r in src)))
    en,zh=segments(src),segments(dst)
    table=[[float("inf")]*(m+1) for _ in range(n+1)]
    back=[[None]*(m+1) for _ in range(n+1)]
    table[0][0]=0
    steps=((1,1),(1,2),(2,1),(1,3),(3,1),(2,2),(1,0),(0,1))
    for i in range(n+1):
        for j in range(m+1):
            for a,b in steps:
                ni,nj=i+a,j+b
                if ni>n or nj>m: continue
                if a and b:
                    cost=match_cost(en[i,a],zh[j,b],ratio,(a,b))
                    if a==b and a>1: cost+=.45
                else:
                    length=src[i][4] if a else dst[j][4]
                    cost=1.05+min(.9,length/85)
                if table[i][j]+cost < table[ni][nj]-1e-9:
                    table[ni][nj]=table[i][j]+cost
                    back[ni][nj]=a,b
    result=[]
    i,j=n,m
    while i or j:
        a,b=back[i][j]
        i,j=i-a,j-b
        if a and b:
            left,right=en[i,a],zh[j,b]
            stable=(a==b==1 and (left[0].casefold()==right[0].casefold() or
                    (abs(left[1]-right[1])<.044 and match_cost(left,right,ratio,(a,b))<1.35
                     and (not left[4] or not right[4] or bool(left[4]&right[4])))))
            result.append((left[0],right[0],src[i:i+a],dst[j:j+b],"sentence" if stable else "passage"))
    return result[::-1]


def align(left, right):
    a, b = left["blocks"], right["blocks"]
    if len(a) * len(b) > 180000:
        return {},{}
    pairs,kinds={},{}
    for i,(en_blocks,zh_blocks) in enumerate(regions(a,b)):
        for n,(en,zh,source,target,kind) in enumerate(align_flow(flow(en_blocks),flow(zh_blocks))):
            sid = f"{i}:0:{n}"
            pairs[sid] = [en, zh]
            kinds[sid] = kind
            for unit in (*source,*target):
                for glyph in unit[1]:
                    glyph[-1]=sid
    return pairs,kinds


def inspect_pdf(path):
    with fitz.open(path, filetype="pdf") as doc:
        if doc.needs_pass:
            raise ValueError("PDF 已加密，请先在本机解锁。")
        if not 0 < len(doc) <= MAX_PAGES:
            raise ValueError(f"目前每份 PDF 支持 1–{MAX_PAGES} 页。")
        probes = sorted(set([0, len(doc) // 4, len(doc) // 2, 3 * len(doc) // 4, len(doc) - 1]))
        text = "\n".join(doc[i].get_text() for i in probes)
        sizes = [[round(page.rect.width, 2), round(page.rect.height, 2)] for page in doc]
        return {"pages": len(doc), "selectable": bool(text.strip()), "han": len(HAN.findall(text)), "sizes": sizes}


def legacy_catalog(directory):
    """Recover previous local PDF snapshots; older versions had no reading metadata."""
    output = []
    for folder in Path(directory).iterdir():
        if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", folder.name):
            continue
        path = folder / "original.pdf"
        if (folder / "reading.json").exists() or not path.is_file():
            continue
        try:
            with fitz.open(path, filetype="pdf") as doc:
                if doc.needs_pass or not 0 < len(doc) <= MAX_PAGES:
                    continue
                first = " ".join(doc[0].get_text().split())
                if ("PAPER DESK / SYNTHETIC RESEARCH EXAMPLE" in first or
                    "PAPER DESK / FICTIONAL RESEARCH EXAMPLE" in first or
                    ("Broadband photometry" in first and "These values are illustrative." in first)):
                    continue
                title = (doc.metadata or {}).get("title", "").strip()
                if not title:
                    choices = []
                    for block in doc[0].get_text("dict", flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)["blocks"]:
                        spans = [s for line in block.get("lines", []) for s in line["spans"] if s["text"].strip()]
                        text = " ".join(s["text"].strip() for s in spans)
                        if spans and 12 <= len(text) <= 250 and block["bbox"][1] < doc[0].rect.height * .55:
                            choices.append((max(s["size"] for s in spans),text))
                    title = max(choices,default=(0,""))[1]
                candidates = sorted((p for p in folder.glob("translation*.pdf")
                    if re.fullmatch(r"translation(?:-[a-f0-9-]{36})?\.pdf",p.name)),
                    key=lambda p:p.stat().st_mtime, reverse=True)
                translation = ""
                for candidate in candidates:
                    try:
                        with fitz.open(candidate) as chinese:
                            if len(chinese) == len(doc) and not chinese.needs_pass:
                                translation = candidate.name
                                break
                    except (OSError, ValueError, RuntimeError):
                        continue
                output.append({"id": folder.name, "title": title[:250] or f"旧文档（{len(doc)} 页）",
                    "pages":len(doc),"translation":translation,"openedAt":round(max(path.stat().st_mtime,
                    (folder/translation).stat().st_mtime if translation else 0)*1000)})
        except (OSError, ValueError, RuntimeError):
            continue
    return output


def read_page(original, translation, index):
    with fitz.open(original, filetype="pdf") as doc:
        left = extract(doc[index], True)
    right, pairs, kinds = None, {}, {}
    if translation:
        with fitz.open(translation, filetype="pdf") as doc:
            right = extract(doc[index], True)
        pairs,kinds = align(left, right)
    for side in filter(None, (left, right)):
        side["rows"] = [row for block in side.pop("blocks") for row in block["rows"]]
    return {"original": left, "translation": right, "pairs": pairs, "pairKinds":kinds}


def excerpt(path, page, question):
    """Give the model the current page plus the most relevant pages, with real page labels."""
    query = set(re.findall(r"[a-z]{3,}|[\u3400-\u9fff]{2,}", question.lower()))
    with fitz.open(path, filetype="pdf") as doc:
        focus = max(0, min(page, len(doc) - 1))
        texts = [LAYOUT_CONTROLS.sub(" ", p.get_text(sort=True))[:8500] for p in doc]
    terms = [(q, q.casefold()) for q in sorted(query, key=lambda q: (-len(q), q))[:30]]
    def score(n):
        body = texts[n].casefold()
        return sum((2 + min(4, len(term) // 3)) for _, term in terms if term in body) - .05 * abs(n - focus)
    if len(texts) <= 4:
        chosen = list(range(len(texts)))
    else:
        others = sorted((i for i in range(len(texts)) if i not in {focus, 0}), key=score, reverse=True)
        chosen = list(dict.fromkeys([focus, 0, *others[:2]]))
    chosen = [i for i in chosen if texts[i].strip()]
    return {"text": "\n\n".join(f"[第 {i+1} 页]\n{texts[i]}" for i in chosen),
            "pages": [i+1 for i in chosen]}


if __name__ == "__main__":
    try:
        verb, *args = sys.argv[1:]
        if verb == "inspect":
            result = inspect_pdf(args[0])
        elif verb == "page":
            result = read_page(args[0], args[1], int(args[2]))
        elif verb == "excerpt":
            result = excerpt(args[0], int(args[1]), args[2])
        elif verb == "demo":
            from paper_demo import demo
            result = demo(args[0])
        elif verb == "legacy":
            result = legacy_catalog(args[0])
        else:
            raise ValueError("Unknown action")
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=True))
        sys.exit(1)
