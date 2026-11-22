"""Generate the selectable, page-matched documents for the built-in demo."""

from html import escape
from pathlib import Path

import pymupdf as fitz


WIDTH, HEIGHT = 612, 792
LEFT, RIGHT = 43, 569
INK, MUTED, TEAL = "#122d32", "#40565e", "#12664f"
RULE, TINT, WHITE = "#cdded9", "#f0f6f3", "#ffffff"
DATA = (("Blank sky", "空白天区", 1), ("Nearby dust", "邻近尘埃", 3), ("M78 target", "M78 目标区", 32))
TOTAL = 40
TELESCOPE_EN = (
    "Ultraviolet Light-curve Telescope for Rapid Astronomical Monitoring of Anomalies in Nebulae (ULTRAMAN)"
)
TELESCOPE_ZH = "用于快速监测星云异常信号的紫外光变望远镜（ULTRAMAN）"


def rate(count):
    return f"{100 * count / TOTAL:g}%"


def rgb(hex_color):
    return tuple(int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))


class Spread:
    def __init__(self, page, chinese):
        self.page = page
        self.chinese = chinese

    def text(self, x, y, w, h, en, zh=None, *, size=11, color=INK,
             bold=False, align="left", leading=1.38):
        value = zh if self.chinese and zh is not None else en
        html = escape(value).replace("\n", "<br>")
        css = (f"body{{margin:0;font-family:sans-serif;font-size:{size}pt;"
               f"color:{color};font-weight:{'bold' if bold else 'normal'};"
               f"text-align:{align};line-height:{leading}}}")
        spare, _ = self.page.insert_htmlbox(
            fitz.Rect(x, y, x + w, y + h), html, css=css, scale_low=1
        )
        if spare < 0:
            raise ValueError(f"Demo text overflows at ({x}, {y}): {value}")

    def rect(self, x, y, w, h, fill, border=None):
        self.page.draw_rect(fitz.Rect(x, y, x + w, y + h), fill=rgb(fill),
                            color=rgb(border) if border else None, width=.7)

    def rule(self, x1, x2, y, color=RULE, width=.75):
        self.page.draw_line((x1, y), (x2, y), color=rgb(color), width=width)

    def frame(self):
        self.rect(LEFT, 37, 22, 4, TEAL)
        self.text(LEFT, 49, 407, 20, "PAPER DESK / FICTIONAL RESEARCH EXAMPLE",
                  "文献对读 / 虚构研究示例", size=9, color=TEAL, bold=True)
        self.text(450, 49, 119, 20, "M78 FIELD REPORT", "M78 观测纪要",
                  size=9, color=MUTED, align="right")
        self.rule(LEFT, RIGHT, 71)

    def footer(self, page_number):
        self.rule(LEFT, RIGHT, 746)
        self.text(LEFT, 758, 440, 19, "ULTRAMAN TELESCOPE  /  SCIENCE FICTION",
                  "奥特曼望远镜  /  科幻演示", size=9, color=MUTED)
        self.text(480, 758, 89, 19, f"{page_number:02d} / 02", size=9,
                  color=TEAL, bold=True, align="right")

    def section(self, x, y, number, en, zh):
        self.text(x, y + 2, 25, 18, number, size=10, color=TEAL, bold=True)
        self.text(x + 29, y, 220, 22, en, zh, size=13.5, bold=True)

    def chart(self):
        self.rect(LEFT, 485, RIGHT - LEFT, 197, TINT, RULE)
        self.text(59, 496, 490, 22, "Repeating pulses by field",
                  "三个观测区的重复脉冲检出率", size=14, bold=True)
        self.text(59, 518, 490, 18, "40 observing windows per field", "每个区域安排 40 个观测时段",
                  size=9.5, color=MUTED)
        x, w = 156, 358
        for i, (en, zh, hits) in enumerate(DATA):
            y = 546 + i * 32
            bar = w * hits / TOTAL
            color = TEAL if i == len(DATA) - 1 else "#647f87"
            self.text(59, y - 3, 93, 20, en, zh, size=10, bold=True)
            self.rect(x, y, w, 16, "#dce9e4")
            self.rect(x, y, bar, 16, color)
            self.text(x + bar + 8, y - 3, 55, 20, rate(hits),
                      size=11, color=color, bold=True)
        for tick in (0, 25, 50, 75, 100):
            self.text(x + tick * w / 100 - 20, 651, 40, 18, f"{tick}%",
                      size=8.5, color=MUTED, align="center")
        self.text(LEFT, 694, RIGHT - LEFT, 37,
                  "Figure 1. Each bar shows the share of observing windows with a repeating pulse. "
                  "The chart compares signals, not counts of organisms.",
                  "图 1. 每条横条表示检出重复脉冲的观测时段比例。图中比较的是信号，并非生物个体数量。",
                  size=10, color=MUTED)

    def table(self):
        self.rect(LEFT, 198, RIGHT - LEFT, 34, INK)
        cols = ((57, 114), (185, 100), (322, 93), (450, 104))
        labels = (("Observing field", "观测区域"), ("Windows", "观测时段"),
                  ("With pulses", "检出脉冲"), ("Detection rate", "检出率"))
        for i, ((x, w), (en, zh)) in enumerate(zip(cols, labels)):
            self.text(x, 208, w, 18, en, zh, size=10, bold=True, color=WHITE,
                      align="left" if i == 0 else "right")
        for row, (en, zh, hits) in enumerate(DATA):
            top = 232 + row * 35
            self.rect(LEFT, top, RIGHT - LEFT, 35, TINT if row % 2 == 0 else WHITE)
            self.rule(LEFT, RIGHT, top + 35)
            for i, ((x, w), (value, localized)) in enumerate(zip(cols, (
                (en, zh), (str(TOTAL), None), (str(hits), None), (rate(hits), None),
            ))):
                self.text(x, top + 10, w, 20, value, localized, size=11, bold=i == 3,
                          color=TEAL if i == 3 else INK, align="left" if i == 0 else "right")
        self.text(LEFT, 350, RIGHT - LEFT, 27,
                  "Table 1. One detection is counted at most once per observing window.",
                  "表 1. 每个观测时段最多计入一次检出。", size=10, color=MUTED)

    def first(self):
        self.text(LEFT, 88, RIGHT - LEFT, 91,
                  "The Ultraman Telescope\nFinds Life in M78", "奥特曼望远镜\n在 M78 发现外星生命",
                  size=34, leading=1.13, bold=True)
        self.text(LEFT, 175, RIGHT - LEFT, 23, "From repeating light pulses to a close encounter",
                  "从重复光脉冲，到一次近距离接触", size=12.5, color=MUTED)

        self.rect(LEFT, 205, RIGHT - LEFT, 101, TINT)
        self.rect(LEFT, 205, 3, 101, TEAL)
        self.text(57, 215, 490, 20, "ABSTRACT", "摘要", size=10, color=TEAL, bold=True)
        self.text(57, 237, 495, 66,
                  f"Using the {TELESCOPE_EN}, we monitored M78. "
                  "We detected repeating light pulses in 32 of 40 observing windows. "
                  "A probe later traced the pulses to living organisms inside M78.",
                  f"{TELESCOPE_ZH}对 M78 进行了监测。"
                  "在 40 个观测时段中，有 32 次检出重复光脉冲。随后，探测器确认这些脉冲来自 M78 内的生物。")

        self.section(LEFT, 320, "01", "An unexpected signal", "意外的信号")
        self.section(318, 320, "02", "Control observations", "对照观测")
        self.text(LEFT, 347, 248, 68,
                  "A point of light in the M78 reflection nebula flashed twice every 78 seconds. "
                  "The double pulse returned on three successive nights.",
                  "反射星云 M78 中的一个光点每隔 78 秒连闪两次。这个双脉冲连续三个夜晚出现。")
        self.text(LEFT, 417, 248, 61,
                  "Repeating light is not proof of life. We first tested whether dust or the camera could explain it.",
                  "重复闪光并不能证明存在生命。我们先检验信号是否来自尘埃或相机。")
        self.text(318, 347, 251, 68,
                  f"The {TELESCOPE_EN} took UV images every 2 seconds.",
                  f"{TELESCOPE_ZH}每隔 2 秒拍一张紫外图像。")
        self.text(318, 417, 251, 63,
                  "We imaged the target, nearby dust and blank sky. A double pulse had to repeat at least "
                  "three times in one window to count as a detection.",
                  "我们观测了目标区、邻近尘埃区和空白天区。同一时段内双脉冲至少重复三次，才算检出。")
        self.chart()

    def second(self):
        self.text(LEFT, 88, RIGHT - LEFT, 57, "From signal to discovery",
                  "从可疑信号到确认生命", size=31, leading=1.15, bold=True)
        self.text(LEFT, 151, RIGHT - LEFT, 37,
                  "Detection rate = windows with repeating pulses / all observing windows.",
                  "检出率 = 检出重复脉冲的时段数 / 总观测时段数。",
                  size=12.5, color=MUTED)
        self.table()

        self.section(LEFT, 391, "03", "The telescope result", "望远镜发现了什么")
        self.section(318, 391, "04", "The probe encounter", "探测器看到了什么")
        self.text(LEFT, 423, 248, 54,
                  "We detected the pulse in 80% of target windows and 7.5% of dust windows. "
                  "The signal was concentrated near the target.",
                  "目标区的脉冲检出率为 80%，邻近尘埃区只有 7.5%。信号集中在目标附近。")
        self.text(LEFT, 490, 248, 63,
                  "A rotating rock could still produce a periodic signal. "
                  "We sent an autonomous probe to identify the source at close range.",
                  "自转的岩石也可能产生周期信号。我们派出一台自主探测器，从近处确认信号源。")
        self.text(318, 423, 251, 54,
                  "The probe found translucent organisms beneath an ice crust. "
                  "They emitted the same double pulse in darkness.",
                  "探测器在冰壳下发现了半透明的生物。它们在黑暗中也会发出同样的双脉冲。")
        self.text(318, 490, 251, 63,
                  "Time-lapse images showed individuals growing and dividing. "
                  "The discovery does not tell us whether the flashing carries a message.",
                  "延时影像记录到个体生长和分裂。这仍无法说明闪光是否在传递信息。")

        self.rect(LEFT, 579, RIGHT - LEFT, 96, TINT)
        self.rect(LEFT, 579, 3, 96, TEAL)
        self.text(57, 592, 490, 21, "READING NOTE", "读图提示", size=10, color=TEAL, bold=True)
        self.text(57, 618, 493, 48,
                  "The telescope located a signal. The probe supplied the evidence for life by recording growth "
                  "and division. Can either observation support a claim of intelligent communication?",
                  "望远镜定位了信号。探测器拍到了生长和分裂，为生命存在提供了证据。这些观测能证明存在智慧通信吗？")
        self.text(LEFT, 704, RIGHT - LEFT, 24,
                  "Fictional mission, instrument and results. This document makes no real discovery claim.",
                  "任务、仪器和结果均为虚构，不代表真实的天文发现。", size=9.5, color=MUTED)


def demo(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for chinese, name, title in (
        (False, "original.pdf", "The Ultraman Telescope Finds Life in M78"),
        (True, "translation.pdf", "奥特曼望远镜在 M78 发现外星生命"),
    ):
        with fitz.open() as doc:
            doc.set_metadata({"title": title, "creator": "Paper Desk", "subject": "Fictional reading example"})
            for number, content in enumerate((Spread.first, Spread.second), start=1):
                spread = Spread(doc.new_page(width=WIDTH, height=HEIGHT), chinese)
                spread.frame()
                content(spread)
                spread.footer(number)
            doc.subset_fonts()
            doc.save(directory / name, garbage=4, deflate=True)
    return {"pages": 2}
