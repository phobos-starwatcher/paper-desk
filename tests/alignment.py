"""Regression cases for PDF engines splitting a translated column into text objects."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "marketplace/plugins/paper-desk"))
from paper_pdf import align


def block(x, y, texts, width=.36, step=.023):
    rows=[]
    for idx,text in enumerate(texts):
        h=y+idx*step
        rows.append([[c,x+j*width/len(text),h,width/len(text),.016,None] for j,c in enumerate(text)])
    return {"box":[x,y,x+width,y+(len(texts)-1)*step+.016],"rows":rows}


en={"blocks":[
    block(.07,.15,["There are 42 nearby galaxies in the sample.",
                   "The redshift range is 0.01 to 0.08.",
                   "We used 250 micron data for the dust analysis."]),
    block(.55,.15,["The detector has 42 elements.",
                   "We calibrate it against 17 reference objects."]),
    block(.08,.75,["Mei-Lin Chen and David C. Wu"],width=.32),
]}
zh={"blocks":[
    block(.07,.149,["样本共包含 42 个星系。它们都在近邻宇宙。"]),
    block(.07,.172,["红移范围为 0.01 至 0.08。"]),
    block(.07,.196,["尘埃分析采用 250 微米的数据。"]),
    block(.55,.150,["探测器有 42 个单元。我们用 17 个参考天体"]),
    block(.55,.173,["对其进行校准。"]),
    block(.081,.750,["Mei‑Lin Chen and David C.Wu"],width=.31),
]}

pairs,kinds=align(en,zh)
by_source={text:(sid,translated) for sid,(text,translated) in pairs.items()}
redshift=by_source["The redshift range is 0.01 to 0.08."]
assert redshift[1]=="红移范围为 0.01 至 0.08。"
assert kinds[redshift[0]]=="sentence"
sample=by_source["There are 42 nearby galaxies in the sample."]
assert "它们都在近邻宇宙" in sample[1] and kinds[sample[0]]=="passage"
assert by_source["The detector has 42 elements."][1]=="探测器有 42 个单元。"
assert by_source["We calibrate it against 17 reference objects."][1]=="我们用 17 个参考天体对其进行校准。"
assert by_source["Mei-Lin Chen and David C. Wu"][1]=="Mei‑Lin Chen and David C.Wu"
for paper in (en,zh):
    assert all(g[-1] for b in paper["blocks"] for row in b["rows"] for g in row)

en={"blocks":[block(.08,.15,["The exposure is 200 seconds."])]}
zh={"blocks":[block(.55,.15,["曝光时间为 200 秒。"])]}
assert align(en,zh)==({},{}), "A matching number must not bridge columns"
print("Passed: fragmented columns, split sentences, retained Latin text and gutter isolation.")
