-- ============================================================
-- Migração 0008: fotos das peças (via ImgBB)
-- ============================================================
--
-- O upload da imagem em si é feito diretamente do browser para a API
-- do ImgBB (a imagem nunca passa pelo nosso Worker -- evita limites
-- de tamanho de pedido e poupa largura de banda nossa). Aqui só
-- guardamos o link que o ImgBB devolve, ligado à peça.
--
-- Uma peça pode ter várias fotos (até um limite razoável, controlado
-- no frontend, não na base de dados).

CREATE TABLE IF NOT EXISTS listing_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES parts_listings(id),
  url TEXT NOT NULL,              -- link direto da imagem (data.url do ImgBB)
  thumb_url TEXT,                 -- link da miniatura, se disponível (data.thumb.url)
  delete_url TEXT,                -- link para apagar no ImgBB, guardado por completude
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_photos_listing ON listing_photos(listing_id);
