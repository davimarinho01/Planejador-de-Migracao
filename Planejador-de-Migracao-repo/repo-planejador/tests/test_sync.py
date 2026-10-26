"""Dois computadores no mesmo arquivo do Google Drive, diagnóstico, avisos, risco do câmbio e INE."""
import json
import time
import unittest

from apoio import TesteApp, mock

INE = [{"IndicadorCod": "0009631", "IndicadorDsg": "Valor mediano das rendas por m2 de novos contratos", "Dados": {
    "2022": [{"geocod": "16G1823", "geodsg": "Viseu", "valor": "5.10"}],
    "2023": [{"geocod": "PT", "geodsg": "Portugal", "valor": "7.30"}, {"geocod": "170", "geodsg": "Área Metropolitana de Lisboa", "valor": "12.40"},
             {"geocod": "1701106", "geodsg": "Lisboa", "valor": "15.86"}, {"geocod": "16G1823", "geodsg": "Viseu", "valor": "5.92"}]}}]


class Drive(TesteApp):
    def setUp(self):
        self.drive = {"plano": None, "mtime": 0}

    def computador(self, quem):
        ctx = self.browser.new_context(viewport={"width": 1440, "height": 900})
        ctx.expose_binding("driveLer", lambda source: self.drive)

        def gravar(source, j):
            self.drive["plano"] = j
            self.drive["mtime"] = time.time() * 1000
            return self.drive["mtime"]
        ctx.expose_binding("driveGravar", gravar)
        ctx.add_init_script(mock("drive.js", INEJSON=json.dumps(INE), QUEM=json.dumps(quem)))
        pg = ctx.new_page()
        erros = []
        pg.on("pageerror", lambda e: erros.append(str(e)))
        pg.goto((__import__("apoio").APP)); pg.wait_for_timeout(1500)
        self.addCleanup(ctx.close)
        self.addCleanup(lambda: self.assertEqual(erros, []))
        return pg

    def test_dois_computadores_juntam_as_mudancas(self):
        A = self.computador("Ana")
        self.assertEqual(json.loads(self.drive["plano"])["por"]["nome"], "Ana")
        A.evaluate("__planner.state.metas.poupanca = 450; save()"); A.wait_for_timeout(5500)
        L = self.computador("Bruno")
        self.assertTrue(L.evaluate("document.querySelector('#confirmDlg').open"), "deve perguntar qual plano usar")
        L.click('#confirmOk'); L.wait_for_timeout(1500)
        self.assertEqual(L.evaluate("__planner.state.metas.poupanca"), 450)
        A.evaluate("__planner.state.despesas.find(d => d.nome === 'Academia').valor = 70; __planner.state.vagas.push(novaVaga({ titulo: 'Dev' })); save()")
        L.evaluate("__planner.state.metas.poupanca = 500; __planner.state.tarefas.splice(0, 1); __planner.state.cenarios.base.cambio = 6.10; save()")
        L.wait_for_timeout(300)
        A.evaluate("__planner.state.cenarios.base.cambio = 6.05; save()")
        A.wait_for_timeout(5500); L.wait_for_timeout(500)
        for pg in (A, L, A):
            pg.evaluate("__sistema.sincronizar()"); pg.wait_for_timeout(800)
        q = "JSON.stringify({ a: __planner.state.despesas.find(d => d.nome === 'Academia').valor, p: __planner.state.metas.poupanca, v: __planner.state.vagas.length, t: __planner.state.tarefas.length, c: __planner.state.cenarios.base.cambio })"
        self.assertEqual(A.evaluate(q), L.evaluate(q))
        r = json.loads(A.evaluate(q))
        self.assertEqual((r["a"], r["p"], r["v"], r["c"]), (70, 500, 1, 6.05))
        for segredo in ("travelpayoutsToken", "serpapiKey", "brapiToken", "historico"):
            self.assertNotIn(segredo, self.drive["plano"])

    def test_mescla_tres_vias(self):
        A = self.computador("Ana")
        r = A.evaluate("""() => { const B = { x: 1, l: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }] };
          const L = { x: 2, l: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }] };
          const R = { x: 1, l: [{ id: 'a', v: 5 }] };
          return __sistema.mesclar(B, L, R, { conflitos: [], preferir: 'local' }, 'p'); }""")
        self.assertEqual(r, {"x": 2, "l": [{"id": "a", "v": 5}, {"id": "c", "v": 1}]})

    def test_diagnostico_e_avisos(self):
        A = self.computador("Ana")
        A.click('#nav button[data-view="sistema"]'); A.wait_for_timeout(600)
        A.click('#diagRodar'); A.wait_for_timeout(2500)
        self.assertRegex(A.evaluate("document.querySelector('#diagResumo').textContent"), r"\d+ funcionando, \d+ com falha")
        A.evaluate("__planner.state.config.alertaEuro = 6.5; __planner.state.plano.dataMudanca = '2026-12'")
        A.evaluate("__sistema.verificarAvisos()"); A.wait_for_timeout(1500)
        titulos = A.evaluate("window.__notif.map(n => n.titulo)")
        self.assertTrue(any(t.startswith("Euro a R$") for t in titulos))
        self.assertTrue(any(t.startswith("Checklist") for t in titulos))

    def test_risco_bate_com_o_plano_sem_oscilacao(self):
        A = self.computador("Ana")
        d = A.evaluate("""() => { const r = simularRisco({ vol: 0.0001, tendencia: 0, caminhos: 50 }); const s = simular(JSON.parse(JSON.stringify(__planner.state)), __planner.state.cenarioAtivo);
          return { mc: r.patrimonio_final.p50, det: s.patrimonioFinalEUR }; }""")
        self.assertLess(abs(d["mc"] - d["det"]), max(50, abs(d["det"]) * 0.005))

    def test_ine(self):
        A = self.computador("Ana")
        A.click('#nav button[data-view="cidades"]'); A.wait_for_timeout(500)
        A.click('#ineBuscar'); A.wait_for_timeout(800)
        ine = A.evaluate("__planner.state.ine")
        self.assertEqual(ine["periodo"], "2023")
        self.assertEqual(ine["cidades"]["viseu"]["m2"], 5.92)
        self.assertEqual(ine["cidades"]["lisboa"]["m2"], 15.86)
        self.assertNotIn("porto", ine["cidades"])


if __name__ == "__main__":
    unittest.main()
