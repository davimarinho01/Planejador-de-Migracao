"""Apoio comum dos testes de interface: abre o app num Chromium com window.net simulado."""
import json
import os
import pathlib
import tempfile
import unittest

from playwright.sync_api import sync_playwright

RAIZ = pathlib.Path(__file__).resolve().parents[1]
APP = (RAIZ / "app" / "index.html").as_uri()
MOCKS = pathlib.Path(__file__).resolve().parent / "mocks"
TMP = pathlib.Path(tempfile.mkdtemp(prefix="planejador-testes-"))


def mock(nome, **troca):
    """Lê um mock de tests/mocks e substitui marcadores (ex.: QUEM, INEJSON)."""
    s = (MOCKS / nome).read_text(encoding="utf-8")
    for k, v in troca.items():
        s = s.replace(k, v)
    return s


class TesteApp(unittest.TestCase):
    """Uma instância do navegador por classe de teste."""

    @classmethod
    def setUpClass(cls):
        cls._pw = sync_playwright().start()
        kw = {"args": ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]}
        if os.environ.get("CHROMIUM_PATH"):
            kw["executable_path"] = os.environ["CHROMIUM_PATH"]
        cls.browser = cls._pw.chromium.launch(**kw)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls._pw.stop()

    def abrir(self, script, espera=1200, **ctx_kw):
        ctx = self.browser.new_context(viewport={"width": 1440, "height": 900}, **ctx_kw)
        ctx.add_init_script(script)
        pg = ctx.new_page()
        erros = []
        pg.on("pageerror", lambda e: erros.append(str(e)))
        pg.goto(APP)
        pg.wait_for_timeout(espera)
        self.addCleanup(ctx.close)
        self.addCleanup(lambda: self.assertEqual(erros, [], "erros de JavaScript na página"))
        return pg

    @staticmethod
    def esperar_livre(pg, limite=40):
        """Espera o Vasco terminar a resposta."""
        for _ in range(limite):
            pg.wait_for_timeout(1000)
            if not pg.evaluate("iaOcupado"):
                return
        raise AssertionError("o Vasco não terminou a resposta")


def gerar_fixtures(browser):
    """Cria um PDF, uma imagem e um currículo fictícios para os testes de documentos."""
    pdf, png, cv = TMP / "relatorio.pdf", TMP / "recibo.png", TMP / "curriculo-exemplo.txt"
    if pdf.exists():
        return pdf, png, cv
    pg = browser.new_page(viewport={"width": 900, "height": 500})
    pg.set_content("<h1>Resumo dos cenários</h1><p>Planejamento de teste. Base, Conservador, Estresse.</p>" + "<p>Linha de exemplo com números 1.234,56.</p>" * 40)
    pg.pdf(path=str(pdf))
    pg.set_content("<div style='font:28px sans-serif;padding:40px'><b>RECIBO DE VENCIMENTO</b><p>Vencimento base: 2.100,00 EUR</p><p>Líquido: 1.609,00 EUR</p></div>")
    pg.screenshot(path=str(png))
    pg.close()
    linhas = ["MARIA EXEMPLO — Desenvolvedora Full Stack", "EXPERIÊNCIA", "Empresa X — .NET 8, C#, Angular, Azure (2024–atual)"]
    linhas += [f"Projeto {i}: sistema com .NET, Angular e Azure, testes e CI/CD; atendeu {100 * i} usuários." for i in range(1, 80)]
    cv.write_text("\n".join(linhas), encoding="utf-8")
    return pdf, png, cv


def js(obj):
    return json.dumps(obj, ensure_ascii=False)
