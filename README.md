# ShopSmart – Product Recommendation System

ShopSmart has a Spark-powered local BDA prototype and a lightweight static
frontend prepared for Vercel. The Vercel site uses the same CSV catalog and
content-based recommendation approach, with matching performed in the browser.
It does not need a server, Java, or a Vercel Function, which avoids cold-start
and runtime issues for this small catalog.

## Deploy on Vercel

1. Push this project to a Git provider supported by Vercel, or import the
   project from the Vercel dashboard.
2. Choose **Other** as the framework preset.
3. Leave the build and install commands empty.
4. Set the output directory to `public` (also configured in `vercel.json`).
5. Deploy. The site loads from `public/index.html`; its stylesheet, script, and
   catalog are included in that directory.

The deployed frontend catalog is `public/data/products.csv`. When changing
products, update this file as well as `data/products.csv` so the local Spark
app and hosted frontend stay in sync.

## Run the PySpark BDA app locally on Windows

Requirements: Python 3.10–3.12 and Java 17 or 21, with `JAVA_HOME` set to your
Java installation directory.

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot"
python -m pip install -r requirements.txt
python -m streamlit run app.py --server.address 127.0.0.1 --server.port 8501
```

Change `JAVA_HOME` to your installed Java directory. Streamlit prints the
local URL (normally `http://localhost:8501`).

To preview the Vercel frontend locally, serve the `public` folder with a local
static web server and open its URL. The CSV is loaded over HTTP, so opening
`index.html` directly as a `file://` URL will not load the catalog.
