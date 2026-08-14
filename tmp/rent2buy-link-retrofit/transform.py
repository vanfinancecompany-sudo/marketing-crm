#!/usr/bin/env python3
import csv,json,copy,re,sys
APP="/apply-for-no-credit-check-rent2buy-vans"
STOCK="/view-all-vans"
ABOUT="/what-is-rent2buy-vans"

with open(sys.argv[4],"r",encoding="utf-8") as pf:
    cfg=json.load(pf)
ARTICLE_PLAN=cfg["article_plan"]
STOCK_IDS=set(cfg["stock_ids"])

def remap(url,anchor):
    if url=="https://www.vanfinancecompany.co.uk/rent2buy-application": return APP
    if url=="https://www.vanfinancecompany.co.uk/rent2buyvans":
        a=anchor.lower()
        if "credit check" in a: return ABOUT
        if any(k in a for k in ("available","stock","prices","vehicles","vans")): return STOCK
        return ABOUT
    return url

def link_deco(url): return {"type":"LINK","linkData":{"link":{"url":url,"target":"BLANK"}}}

def links(doc):
    out=[]
    def walk(n):
        if isinstance(n,dict):
            td=n.get("textData")
            if isinstance(td,dict):
                t=td.get("text","")
                for d in td.get("decorations",[]) or []:
                    if d.get("type")=="LINK":
                        u=(((d.get("linkData") or {}).get("link") or {}).get("url"))
                        if u: out.append((t,u))
            for v in n.values():
                if isinstance(v,(dict,list)): walk(v)
        elif isinstance(n,list):
            for v in n: walk(v)
    walk(doc); return out

def replace_old(doc,changes):
    def walk(n):
        if isinstance(n,dict):
            td=n.get("textData")
            if isinstance(td,dict):
                t=td.get("text","")
                for d in td.get("decorations",[]) or []:
                    if d.get("type")=="LINK":
                        l=((d.get("linkData") or {}).get("link") or {})
                        old=l.get("url"); new=remap(old,t) if old else old
                        if new!=old:
                            l["url"]=new; changes.append(("replace_old",t,old,new))
            for v in n.values():
                if isinstance(v,(dict,list)): walk(v)
        elif isinstance(n,list):
            for v in n: walk(v)
    walk(doc)

def add_link_to_text_node(node,start,end,url,seed):
    txt=node["textData"]["text"]; base=node.get("id","text")
    decs=copy.deepcopy(node["textData"].get("decorations",[]) or [])
    out=[]
    def mk(s,label,ds):
        n=copy.deepcopy(node); n["id"]=f"{base}-{seed}{label}"
        n["textData"]["text"]=s; n["textData"]["decorations"]=copy.deepcopy(ds); return n
    if start: out.append(mk(txt[:start],"a",decs))
    out.append(mk(txt[start:end],"b",decs+[link_deco(url)]))
    if end<len(txt): out.append(mk(txt[end:],"c",decs))
    return out

def convert_markdown(doc,changes,counter=[10000]):
    pat=re.compile(r"\[([^\]]+)\]\((https?://[^)]+|/[^)]+)\)")
    def process(p):
        while True:
            kids=p.get("nodes",[]) or []; done=False
            for i,n in enumerate(kids):
                if not isinstance(n,dict) or n.get("type")!="TEXT": continue
                txt=(n.get("textData") or {}).get("text",""); m=pat.search(txt)
                if not m: continue
                anchor,old=m.group(1),m.group(2); new=remap(old,anchor)
                base=n.get("id","text"); decs=copy.deepcopy((n.get("textData") or {}).get("decorations",[]) or [])
                pieces=[]
                def mk(s,label,ds):
                    x=copy.deepcopy(n); x["id"]=f"{base}-md{counter[0]}{label}"
                    x["textData"]["text"]=s; x["textData"]["decorations"]=copy.deepcopy(ds); return x
                if m.start(): pieces.append(mk(txt[:m.start()],"a",decs))
                pieces.append(mk(anchor,"b",decs+[link_deco(new)]))
                if m.end()<len(txt): pieces.append(mk(txt[m.end():],"c",decs))
                p["nodes"]=kids[:i]+pieces+kids[i+1:]; counter[0]+=1
                changes.append(("convert_markdown",anchor,old,new)); done=True; break
            if not done: return
    def walk(n):
        if isinstance(n,dict):
            if n.get("type")=="PARAGRAPH": process(n)
            for x in n.get("nodes",[]) or []: walk(x)
        elif isinstance(n,list):
            for x in n: walk(x)
    walk(doc)

def add_exact(doc,anchor,url,allow_styled=False,counter=[0]):
    paragraphs=[]; faq=False
    def walk(n):
        nonlocal faq
        if isinstance(n,dict):
            if n.get("type")=="HEADING":
                h="".join(((x.get("textData") or {}).get("text","") for x in n.get("nodes",[]) if isinstance(x,dict)))
                if "frequently asked" in h.lower(): faq=True
            if n.get("type")=="PARAGRAPH": paragraphs.append((n,faq))
            for k,v in n.items():
                if k!="nodes" and isinstance(v,(dict,list)): walk(v)
            for x in n.get("nodes",[]) or []: walk(x)
        elif isinstance(n,list):
            for x in n: walk(x)
    walk(doc)
    for want_faq in (False,True):
        for p,isfaq in paragraphs:
            if isfaq!=want_faq: continue
            kids=p.get("nodes",[]) or []
            for i,n in enumerate(kids):
                if not isinstance(n,dict) or n.get("type")!="TEXT": continue
                td=n.get("textData") or {}; txt=td.get("text",""); ds=td.get("decorations",[]) or []
                if any(d.get("type")=="LINK" for d in ds): continue
                if not allow_styled and any(d.get("type") in ("BOLD","ITALIC","UNDERLINE") for d in ds): continue
                m=re.search(re.escape(anchor),txt,re.I)
                if m:
                    counter[0]+=1
                    p["nodes"]=kids[:i]+add_link_to_text_node(n,m.start(),m.end(),url,f"lnk{counter[0]}")+kids[i+1:]
                    return txt[m.start():m.end()]
    return None

def text(doc):
    s=[]
    def walk(n):
        if isinstance(n,dict):
            td=n.get("textData")
            if isinstance(td,dict): s.append(td.get("text",""))
            for v in n.values():
                if isinstance(v,(dict,list)): walk(v)
        elif isinstance(n,list):
            for v in n: walk(v)
    walk(doc); return "".join(s)

def main(src,dst,logfile):
    with open(src,"r",encoding="utf-8-sig",newline="") as f:
        rd=csv.DictReader(f); fields=rd.fieldnames; rows=list(rd)
    slugs={r["slug"] for r in rows}; logs=[]
    for r in rows:
        old=json.loads(r["content"]); new=copy.deepcopy(old); changes=[]
        replace_old(new,changes); convert_markdown(new,changes)
        for anchor,url in ARTICLE_PLAN.get(r["ID"],[]):
            if url not in [u for _,u in links(new)]:
                found=add_exact(new,anchor,url,False)
                if not found: raise RuntimeError(f"Missing planned anchor {anchor!r} in {r['Title']}")
                changes.append(("add_article",found,"",url))
        if r["ID"] in STOCK_IDS and STOCK not in [u for _,u in links(new)]:
            found=add_exact(new,"View available Rent2Buy vans",STOCK,True)
            if not found: raise RuntimeError(f"Missing stock CTA in {r['Title']}")
            changes.append(("add_stock",found,"",STOCK))
        expected=re.sub(r"\[([^\]]+)\]\((https?://[^)]+|/[^)]+)\)",r"\1",text(old))
        if text(new)!=expected: raise RuntimeError(f"Visible text changed: {r['Title']}")
        ls=links(new)
        if any("vanfinancecompany.co.uk" in u for _,u in ls): raise RuntimeError(f"Old domain remains: {r['Title']}")
        if any(u==f"/knowledge-hub-articles/{r['slug']}" for _,u in ls): raise RuntimeError(f"Self link: {r['Title']}")
        if any(u.startswith("/knowledge-hub-articles/") and u.rsplit("/",1)[-1] not in slugs for _,u in ls): raise RuntimeError(f"Bad article destination: {r['Title']}")
        if sum(u.startswith("/knowledge-hub-articles/") for _,u in ls)>2: raise RuntimeError(f"Too many article links: {r['Title']}")
        if sum(u in {APP,STOCK,ABOUT} for _,u in ls)>2: raise RuntimeError(f"Too many commercial links: {r['Title']}")
        r["content"]=json.dumps(new,ensure_ascii=False,separators=(",",":"))
        for c in changes: logs.append([r["ID"],r["Title"],*c])
    with open(dst,"w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(rows)
    with open(logfile,"w",encoding="utf-8",newline="") as f:
        w=csv.writer(f); w.writerow(["id","title","change_type","anchor","old_url","new_url"]); w.writerows(logs)
    print(json.dumps({"articles":len(rows),"changes":len(logs)}))
if __name__=="__main__":
    main(sys.argv[1],sys.argv[2],sys.argv[3])
