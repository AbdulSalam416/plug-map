"""Extract stage: turn a harvested repository into claims.

Three independent readers, each recording how it found a term:
    deps.py    dependency manifests  -> method "dependency" (role "uses")
    readme.py  README lines          -> method "readme"     (role "uses")
    code.py    source-code calls     -> method "code"       (role reads | writes | speaks | pulls)
"""
