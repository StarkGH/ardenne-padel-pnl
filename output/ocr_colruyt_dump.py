import fitz
import numpy as np
from rapidocr_onnxruntime import RapidOCR

pdf='/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared/BAR/DB/COLRUYT OCTOBRE 2025 400,28€.pdf'
doc=fitz.open(pdf)
ocr=RapidOCR()
for i,p in enumerate(doc):
    pix=p.get_pixmap(dpi=300)
    arr=np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n==4:
      arr=arr[:,:,:3]
    result,_=ocr(arr)
    print('\n=== PAGE',i+1,'===')
    if not result:
      print('NO OCR')
      continue
    lines=[]
    for r in result:
      box, txt, score = r
      y=sum(pt[1] for pt in box)/4
      x=min(pt[0] for pt in box)
      lines.append((y,x,txt,score))
    lines.sort(key=lambda t:(round(t[0]/8),t[1]))
    for y,x,txt,score in lines[:450]:
      print(f"{y:8.1f} {x:7.1f} {score:.3f} | {txt}")
