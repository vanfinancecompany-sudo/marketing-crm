#!/usr/bin/env python3
import csv,json,copy,re,sys
APP="/apply-for-no-credit-check-rent2buy-vans"
STOCK="/view-all-vans"
ABOUT="/what-is-rent2buy-vans"
COMMERCIAL={APP,STOCK,ABOUT}
with open(sys.argv[4],encoding="utf-8") as f: CFG=json.load(f)
PLAN=CFG["article_plan"]; STOCK_IDS=set(CFG["stock_ids"])

def remap(url,anchor):
    if url=="https://www.vanfinancecompany.co.uk/rent2buy-application": return APP
    if url=="https://www.vanfinancecompany.co.uk/rent2buyvans":
        a=anchor.lower()
        if "credit check" in a: return ABOUT
        if any(k in a for k in ("available","stock","prices","vehicles","vans")): return STOCK
        return ABOUT
    return url

def link_deco(url): return {"type":"LINK","linkData":{"link":{"url":url,"target":"SELF"}}}

def node_text(node):
    if not isinstance(node,dict): return ""
    out=[]
    def walk(n):
        if isinstance(n,dict):
            td=n.get("textData")
            if isinstance(td,dict): out.append(td.get("text",""))
            for x in n.get("nodes",[]) or []: walk(x)
        elif isinstance(n,list):
            for x in n: walk(x)
    walk(node); return "".join(out)

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
                        if u: out.append((t,u,n.get("id","")))
            for v in n.values():
                if isinstance(v,(dict,list)): walk(v)
        elif isinstance(n,list):
            for v in n: walk(v)
    walk(doc); return out

def remove_generated_links(doc,changes):
    """Remove only links created by the first retrofit pass. Preserve text and all other decorations."""
    def walk(n):
        if isinstance(n,dict):
            td=n.get("textData")
            nid=n.get("id","")
            if isinstance(td,dict) and "-r2b" in nid:
                old_decs=td.get("decorations",[]) or []
                keep=[]
                for d in old_decs:
                    if d.get("type")=="LINK":
                        u=(((d.get("linkData") or {}).get("link") or {}).get("url"))
                        changes.append(("remove_generated",td.get("text",""),u or "",""))
                    else: keep.append(d)
                td["decorations"]=keep
            for v in n.values():
                if isinstance(v,(dict,list)): walk(v)
        elif isinstance(n,list):
            for v in n: walk(v)
    walk(doc)

def replace_old(doc,changes):
    def walk(n):
        if isinstance(n,dict):
            td=n.get("textData")
            if isinstance(td,dict):
                anchor=td.get("text","")
                for d in td.get("decorations",[]) or []:
                    if d.get("type")=="LINK":
                        l=((d.get("linkData") or {}).get("link") or {})
                        old=l.get("url"); new=remap(old,anchor) if old else old
                        if new!=old:
                            l["url"]=new
                            if "target" in l: l["target"]="SELF"
                            if "target" in (d.get("linkData") or {}): d["linkData"]["target"]="SELF"
                            changes.append(("replace_old",anchor,old,new))
            for v in n.values():
                if isinstance(v,(dict,list)): walk(v)
        elif isinstance(n,list):
            for v in n: walk(v)
    walk(doc)

def split_link(node,start,end,url,seed):
    txt=node["textData"]["text"]; base=node.get("id","text"); decs=copy.deepcopy(node["textData"].get("decorations",[]) or [])
    def mk(s,label,ds):
        x=copy.deepcopy(node); x["id"]=f"{base}-{seed}{label}"; x["textData"]["text"]=s; x["textData"]["decorations"]=copy.deepcopy(ds); return x
    out=[]
    if start: out.append(mk(txt[:start],"a",decs))
    out.append(mk(txt[start:end],"b",decs+[link_deco(url)]))
    if end<len(txt): out.append(mk(txt[end:],"c",decs))
    return out

def convert_markdown(doc,changes):
    pat=re.compile(r"\[([^\]]+)\]\((https?://[^)]+|/[^)]+)\)"); counter=[10000]
    def process(p):
        while True:
            kids=p.get("nodes",[]) or []; hit=False
            for i,n in enumerate(kids):
                if not isinstance(n,dict) or n.get("type")!="TEXT": continue
                txt=(n.get("textData") or {}).get("text",""); m=pat.search(txt)
                if not m: continue
                anchor,old=m.group(1),m.group(2); new=remap(old,anchor)
                base=n.get("id","text"); decs=copy.deepcopy((n.get("textData") or {}).get("decorations",[]) or [])
                def mk(s,label,ds):
                    x=copy.deepcopy(n); x["id"]=f"{base}-md{counter[0]}{label}"; x["textData"]["text"]=s; x["textData"]["decorations"]=copy.deepcopy(ds); return x
                pieces=[]
                if m.start(): pieces.append(mk(txt[:m.start()],"a",decs))
                pieces.append(mk(anchor,"b",decs+[link_deco(new)]))
                if m.end()<len(txt): pieces.append(mk(txt[m.end():],"c",decs))
                p["nodes"]=kids[:i]+pieces+kids[i+1:]; counter[0]+=1; changes.append(("convert_markdown",anchor,old,new)); hit=True; break
            if not hit: return
    def walk(n):
        if isinstance(n,dict):
            if n.get("type")=="PARAGRAPH": process(n)
            for x in n.get("nodes",[]) or []: walk(x)
        elif isinstance(n,list):
            for x in n: walk(x)
    walk(doc)

def body_paragraphs(doc):
    """Return actual Article Body paragraphs first, then FAQ paragraphs. Ignore CMS metadata-style preamble."""
    body=[]; faq=[]; section="preamble"
    for top in doc.get("nodes",[]) or []:
        if isinstance(top,dict) and top.get("type")=="HEADING":
            h=node_text(top).strip().lower()
            if h=="article body" or h.startswith("article body"):
                section="body"; continue
            if "frequently asked questions" in h:
                section="faq"; continue
        if section not in ("body","faq"): continue
        target=body if section=="body" else faq
        def collect(n):
            if isinstance(n,dict):
                if n.get("type")=="PARAGRAPH": target.append(n)
                else:
                    for x in n.get("nodes",[]) or []: collect(x)
            elif isinstance(n,list):
                for x in n: collect(x)
        collect(top)
    return body,faq

def add_exact(doc,anchor,url,allow_styled=False):
    body,faq=body_paragraphs(doc); counter=[0]
    for p in body+faq:
        kids=p.get("nodes",[]) or []
        for i,n in enumerate(kids):
            if not isinstance(n,dict) or n.get("type")!="TEXT": continue
            td=n.get("textData") or {}; txt=td.get("text",""); ds=td.get("decorations",[]) or []
            if any(d.get("type")=="LINK" for d in ds): continue
            if not allow_styled and any(d.get("type") in ("BOLD","ITALIC","UNDERLINE") for d in ds): continue
            m=re.search(re.escape(anchor),txt,re.I)
            if m:
                counter[0]+=1; p["nodes"]=kids[:i]+split_link(n,m.start(),m.end(),url,f"r2bbody{counter[0]}")+kids[i+1:]
                return txt[m.start():m.end()]
    return None

def visible_text(doc):
    out=[]
    def walk(n):
        if isinstance(n,dict):
            td=n.get("textData")
            if isinstance(td,dict): out.append(td.get("text",""))
            for v in n.values():
                if isinstance(v,(dict,list)): walk(v)
        elif isinstance(n,list):
            for v in n: walk(v)
    walk(doc); return "".join(out)

def link_is_after_article_body(doc,target_url):
    body,faq=body_paragraphs(doc)
    ids=set()
    def collect_ids(n):
        if isinstance(n,dict):
            ids.add(n.get("id",""))
            for x in n.get("nodes",[]) or []: collect_ids(x)
    for p in body+faq: collect_ids(p)
    for _,u,nid in links(doc):
        if u==target_url and nid in ids: return True
    return False

def main(src,dst,logfile):
    with open(src,encoding="utf-8-sig",newline="") as f:
        rd=csv.DictReader(f); fields=rd.fieldnames; rows=list(rd)
    assert len(rows)==52, len(rows)
    slugs={r["slug"] for r in rows}; logs=[]
    stats={"articles":52,"remove_generated":0,"replace_old":0,"convert_markdown":0,"add_article":0,"add_stock":0,"planned_anchor_skips":0,"articles_with_kh_links":0,"articles_with_commercial_links":0,"old_domain_links":0,"self_links":0,"bad_article_targets":0}
    for r in rows:
        rid=r["ID"]; old=json.loads(r["content"]); new=copy.deepcopy(old); changes=[]
        remove_generated_links(new,changes)
        replace_old(new,changes)
        convert_markdown(new,changes)
        existing=links(new); kh=sum(u.startswith("/knowledge-hub-articles/") for _,u,_ in existing)
        for anchor,url in PLAN.get(rid,[]):
            existing=links(new)
            if kh>=2: break
            if url in [u for _,u,_ in existing]: continue
            found=add_exact(new,anchor,url,False)
            if found:
                changes.append(("add_article",found,"",url)); kh+=1
            else:
                stats["planned_anchor_skips"]+=1
        existing=links(new); commercial=sum(u in COMMERCIAL for _,u,_ in existing)
        if rid in STOCK_IDS and STOCK not in [u for _,u,_ in existing] and commercial<2:
            found=add_exact(new,"View available Rent2Buy vans",STOCK,True)
            if found: changes.append(("add_stock",found,"",STOCK))
        if visible_text(new)!=visible_text(old): raise RuntimeError(f"Visible text changed: {r['Title']}")
        ls=links(new)
        olddom=[u for _,u,_ in ls if "vanfinancecompany.co.uk" in u]
        selflinks=[u for _,u,_ in ls if u==f"/knowledge-hub-articles/{r['slug']}"]
        bad=[u for _,u,_ in ls if u.startswith("/knowledge-hub-articles/") and u.rsplit("/",1)[-1] not in slugs]
        if olddom: raise RuntimeError(f"Old domain remains: {r['Title']} {olddom}")
        if selflinks: raise RuntimeError(f"Self link: {r['Title']}")
        if bad: raise RuntimeError(f"Bad article destination {bad}: {r['Title']}")
        # Any newly generated contextual/stock link must be in Article Body or FAQ.
        for c in changes:
            if c[0] in ("add_article","add_stock") and not link_is_after_article_body(new,c[3]):
                raise RuntimeError(f"Generated link outside Article Body/FAQ: {r['Title']} {c[3]}")
        if any(u.startswith("/knowledge-hub-articles/") for _,u,_ in ls): stats["articles_with_kh_links"]+=1
        if any(u in COMMERCIAL for _,u,_ in ls): stats["articles_with_commercial_links"]+=1
        r["content"]=json.dumps(new,ensure_ascii=False,separators=(",",":"))
        for c in changes:
            logs.append([rid,r["Title"],*c])
            if c[0] in stats: stats[c[0]]+=1
    outfields=['_id' if x=='ID' else x for x in fields]
    for r in rows: r['_id']=r.pop('ID')
    with open(dst,"w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=outfields); w.writeheader(); w.writerows(rows)
    with open(logfile,"w",encoding="utf-8",newline="") as f:
        w=csv.writer(f); w.writerow(["id","title","change_type","anchor","old_url","new_url"]); w.writerows(logs)
    print(json.dumps(stats,sort_keys=True))
if __name__=="__main__": main(sys.argv[1],sys.argv[2],sys.argv[3])
