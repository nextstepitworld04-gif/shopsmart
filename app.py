from pathlib import Path
import re

import pandas as pd
import plotly.express as px
import streamlit as st
from pyspark.sql import SparkSession
from pyspark.sql import functions as F


DATA_PATH = Path(__file__).parent / "data" / "products.csv"


@st.cache_data(show_spinner=False)
def load_products_and_category_counts(csv_path: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    spark = (
        SparkSession.builder.master("local[1]")
        .appName("ShopSmart Product Recommendations")
        .config("spark.ui.enabled", "false")
        .config("spark.driver.host", "127.0.0.1")
        .getOrCreate()
    )
    products = (
        spark.read.option("header", True).option("inferSchema", True).csv(csv_path)
        .withColumn("product_id", F.trim(F.col("product_id").cast("string")))
        .withColumn("name", F.trim(F.col("name")))
        .withColumn("category", F.trim(F.col("category")))
        .withColumn("description", F.trim(F.coalesce(F.col("description"), F.lit(""))))
        .withColumn("price", F.col("price").cast("double"))
        .filter(F.col("product_id").isNotNull() & (F.col("product_id") != ""))
        .filter(F.col("name").isNotNull() & (F.col("name") != ""))
        .filter(F.col("price").isNotNull() & ~F.isnan(F.col("price")) & (F.col("price") >= 0))
        .withColumn("category", F.when(F.col("category").isNull() | (F.col("category") == ""), "Uncategorized").otherwise(F.col("category")))
        .dropDuplicates(["product_id"])
        .withColumn("_name_key", F.lower(F.col("name")))
        .dropDuplicates(["_name_key"])
        .drop("_name_key")
    )
    category_counts = products.groupBy("category").count().orderBy("category")
    return products.toPandas(), category_counts.toPandas()


def tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


@st.cache_data(show_spinner=False)
def build_recommendation_index(products: pd.DataFrame) -> tuple[list[set[str]], list[str]]:
    corpus = (products["category"] + " " + products["name"] + " " + products["description"]).tolist()
    return [tokens(text) for text in corpus], products["category"].tolist()


def recommend_products(products: pd.DataFrame, selected_name: str) -> pd.DataFrame:
    selected_idx = products.index[products["name"] == selected_name][0]
    product_tokens, categories = build_recommendation_index(products)
    selected_tokens = product_tokens[selected_idx]
    scores = []
    for i, candidate in enumerate(product_tokens):
        if i == selected_idx:
            scores.append(-1.0)
            continue
        union = selected_tokens | candidate
        overlap = len(selected_tokens & candidate) / len(union) if union else 0.0
        scores.append((1.0 if categories[i] == categories[selected_idx] else 0.0) + overlap)
    ranked = products.assign(_similarity=scores).sort_values(["_similarity", "name"], ascending=[False, True], kind="stable")
    return ranked.head(6).drop(columns="_similarity")


st.set_page_config(page_title="ShopSmart | Discover", page_icon="✦", layout="wide")
st.markdown("""
<style>
:root { --bg:#0b1220; --panel:#111b2b; --line:#263449; --ink:#edf3fa; --muted:#9baabd; --mint:#8de3ce; --blue:#83b8ff; --lilac:#c2a2ff; --coral:#ffad91; }
.stApp { background:var(--bg); color:var(--ink); font-family:Arial,sans-serif; }
.block-container { max-width:1140px; padding:2rem 1.5rem 3.5rem; }
[data-testid="stHeader"] { background:transparent; }
section[data-testid="stSidebar"] { background:#101a2a; border-right:1px solid var(--line); }
section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] h2 { color:var(--mint); }
h1,h2,h3,p,label { font-family:Arial,sans-serif; }
h1 { letter-spacing:-.035em; font-size:clamp(2rem,4vw,3rem)!important; margin-bottom:.35rem!important; }
.eyebrow { color:var(--mint); font-size:.72rem; font-weight:700; letter-spacing:.14em; text-transform:uppercase; }
.lede { color:var(--muted); font-size:1rem; margin:0 0 1.2rem; }
.metric-card,.feature-card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:18px 20px; }
.metric-card { border-top:2px solid var(--mint); }
.metric-card.blue { border-top-color:var(--blue); }
.metric-card.lilac { border-top-color:var(--lilac); }
.metric-label { font-size:.72rem; color:var(--muted); text-transform:uppercase; letter-spacing:.1em; }
.metric-value { font-size:1.45rem; font-weight:700; margin-top:6px; }
.feature-card { min-height:155px; height:100%; transition:border-color .18s ease; }
.feature-card:hover { border-color:#52766f; }
.feature-card:before { content:""; display:block; height:3px; margin:-18px -20px 15px; border-radius:14px 14px 0 0; background:linear-gradient(90deg,var(--mint),var(--blue),var(--lilac)); }
.card-top { display:flex; justify-content:space-between; gap:12px; align-items:center; }
.pill { color:var(--mint); border:1px solid #37655d; background:#142b2b; border-radius:30px; padding:4px 9px; font-size:.68rem; }
.price { color:var(--ink); font-size:.8rem; font-weight:600; }
.feature-card h3 { font-size:1rem; margin:.85rem 0 .4rem; }
.feature-card p { color:var(--muted); font-size:.82rem; line-height:1.5; margin:0; }
div[data-testid="stSelectbox"] label { color:var(--muted); font-size:.75rem; font-weight:600; text-transform:uppercase; letter-spacing:.08em; }
div.stButton > button { border:1px solid #77cbb7; border-radius:9px; color:#0b1820; font-weight:700; background:var(--mint); }
div.stButton > button:hover { color:#0b1820; border-color:#a8efdf; background:#a8efdf; }
div[data-testid="stPlotlyChart"] { width:100%; overflow:hidden; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:8px; }
hr { border-color:var(--line); }
@media (max-width:700px) { .block-container { padding:1.3rem 1rem 2.5rem; } .metric-card { padding:14px; } .metric-value { font-size:1.1rem; } }
</style>
""", unsafe_allow_html=True)

try:
    products, category_counts = load_products_and_category_counts(str(DATA_PATH))
except Exception as exc:
    st.error("Could not load the product catalog. Check that data/products.csv is present and readable.")
    st.exception(exc)
    st.stop()

with st.sidebar:
    st.markdown("## ✦ ShopSmart")
    st.caption("CURATED PRODUCT DISCOVERY")
    st.markdown("---")
    st.markdown("### Explore the catalog")
    category_options = ["All categories", *sorted(products["category"].unique())]
    category_filter = st.selectbox("Category", category_options, key="category_filter")
    min_price = float(products["price"].min())
    max_price = float(products["price"].max())
    price_range = st.slider("Price range", min_value=min_price, max_value=max_price, value=(min_price, max_price), step=1.0, format="$%.0f")
    search_text = st.text_input("Search products", placeholder="Name or keyword")

filtered_products = products.copy()
if category_filter != "All categories":
    filtered_products = filtered_products[filtered_products["category"] == category_filter]
filtered_products = filtered_products[filtered_products["price"].between(price_range[0], price_range[1])]
if search_text.strip():
    search_match = (filtered_products["name"] + " " + filtered_products["description"]).str.contains(search_text.strip(), case=False, regex=False)
    filtered_products = filtered_products[search_match]

st.markdown('<div class="eyebrow">ShopSmart &nbsp; / &nbsp; Curated Product Discovery</div>', unsafe_allow_html=True)
st.title("Find your next favorite.")
st.markdown('<p class="lede">A smarter way to explore the essentials, tuned to what you already like.</p>', unsafe_allow_html=True)

m1, m2, m3 = st.columns(3)
for col, label, value, accent in [(m1, "Products in catalog", f"{len(products):02d}", "mint"), (m2, "Categories", f"{len(category_counts):02d}", "blue"), (m3, "Recommendation method", "Content match", "lilac")]:
    col.markdown(f'<div class="metric-card {accent}"><div class="metric-label">{label}</div><div class="metric-value">{value}</div></div>', unsafe_allow_html=True)

st.write("")
with st.sidebar:
    st.markdown("---")
    st.markdown(f"**{len(filtered_products)}** matching products")
    st.caption(f"Average catalog price · ${products['price'].mean():.2f}")
if "selected_product" not in st.session_state:
    st.session_state.selected_product = filtered_products["name"].iloc[0] if not filtered_products.empty else products["name"].iloc[0]

left, right = st.columns([1, 1.45], gap="large")
with left:
    title_col, reset_col = st.columns([3, 1])
    title_col.markdown("### Build your match")
    if reset_col.button("Reset", key="reset_selection", use_container_width=True):
        st.session_state.selected_product = filtered_products["name"].iloc[0] if not filtered_products.empty else products["name"].iloc[0]
        st.session_state.pop("recommendations", None)
        st.rerun()
    if filtered_products.empty:
        st.info("No products match these filters. Adjust the sidebar to continue.")
        st.session_state.pop("recommendations", None)
        show_recs = False
    else:
        if st.session_state.selected_product not in filtered_products["name"].tolist():
            st.session_state.selected_product = filtered_products["name"].iloc[0]
        selected_name = st.selectbox("Choose a product", filtered_products["name"].tolist(), key="selected_product")
        selected = products.loc[products["name"] == selected_name].iloc[0]
        st.markdown(f'<div class="feature-card"><div class="card-top"><span class="pill">{selected["category"]}</span><span class="price">${selected["price"]:.2f}</span></div><h3>{selected["name"]}</h3><p>{selected["description"]}</p></div>', unsafe_allow_html=True)
        st.write("")
        show_recs = st.button("Find Similar Products", type="primary", use_container_width=True)
with right:
    st.markdown("### Products by category")
    st.caption("A quick view of what is available in the catalog.")
    fig = px.bar(category_counts, x="category", y="count", labels={"category": "", "count": "Products"}, template="plotly_dark")
    fig.update_layout(autosize=True, showlegend=False, paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", margin=dict(l=12,r=10,t=8,b=58), height=330, font=dict(family="Arial, sans-serif",color="#b7c3d3"), xaxis=dict(showgrid=False, tickangle=-30, automargin=True), yaxis=dict(showgrid=True,gridcolor="#263449",zeroline=False, rangemode="tozero", automargin=True))
    category_colors = ["#8de3ce", "#83b8ff", "#c2a2ff", "#ffad91", "#f5d477", "#75d8ed", "#f39bc4"]
    fig.update_traces(marker_line_width=0, marker_color=category_colors[:len(category_counts)], hovertemplate="%{x}<br>%{y} products<extra></extra>")
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False, "responsive": True, "scrollZoom": False})

if show_recs:
    st.session_state.recommendations = recommend_products(products, selected_name)
if "recommendations" in st.session_state:
    recommendations = st.session_state.recommendations
    st.markdown("<hr>", unsafe_allow_html=True)
    st.markdown('<div class="eyebrow">PERSONALIZED FOR YOU</div>', unsafe_allow_html=True)
    st.markdown("### Recommended for you")
    cols = st.columns(3, gap="medium")
    for i, (_, row) in enumerate(recommendations.iterrows()):
        cols[i % 3].markdown(f'<div class="feature-card"><div class="card-top"><span class="pill">{row["category"]}</span><span class="price">${row["price"]:.2f}</span></div><h3>{row["name"]}</h3><p>{row["description"]}</p></div>', unsafe_allow_html=True)
    if recommendations.empty:
        st.info("No similar products are available yet. Try another selection.")

with st.expander("How matching works"):
    st.write("The recommendation engine compares product names, categories, and descriptions. Shared words build a similarity score, with an extra boost for products in the same category. The app caches the cleaned catalog and token index so later interactions are quick.")
