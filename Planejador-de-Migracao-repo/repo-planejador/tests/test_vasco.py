"""Vagas, ascendência, documentos, voz, regras vigiadas, euros, agenda e relatório."""
import json
import unittest

from apoio import TesteApp, mock, gerar_fixtures


class Vasco(TesteApp):
    def setUp(self):
        self.pg = self.abrir(mock("vasco.js"), accept_downloads=True, permissions=["microphone"])
        self.S = self.pg.evaluate

    def test_vaga_registrada_pelo_vasco_e_usada_no_plano(self):
        pg = self.pg
        pg.click('#nav button[data-view="vagas"]'); pg.wait_for_timeout(400)
        pg.fill('#vgsTexto', 'https://www.itjobs.pt/oferta/1 Desenvolvedor .NET Pleno, Viseu, 30-34k')
        pg.click('#vgsAnalisar'); self.esperar_livre(pg)
        v = self.S("__planner.state.vagas[0]")
        self.assertEqual((v["cidade"], v["brutoAnual"], v["modalidade"]), ("viseu", 32000, "hibrido"))
        pg.click('#iaFechar'); pg.click('#tblVagas [data-abrir]'); pg.wait_for_timeout(800)
        pg.click('#vgsUsar'); pg.wait_for_timeout(300); pg.click('#confirmOk'); pg.wait_for_timeout(400)
        r = self.S("__planner.state.rendas.find(r => r.id.startsWith('vaga_'))")
        self.assertEqual((r["tipo"], r["pagamentos"]), ("trabalho_pt", 14))
        self.assertTrue(r["substitui"])
        self.assertEqual(self.S("__planner.state.rendas.find(r => r.tipo === 'beneficio').fim"), 2)

    def test_ifici_usa_o_regime_mais_barato(self):
        x = self.S("""() => { const v = novaVaga({ titulo: 'Dev', brutoAnual: 32000, ificiEmpresa: 'sim', ificiQualificacao: 'sim' });
          const s = simularVaga(v), i = simularVagaIfici(v); return { usada: s.sobra_com_vaga, com: i.com.sobra_com_vaga, sem: i.sem.sobra_com_vaga, compensa: s.ifici_compensa }; }""")
        self.assertEqual(x["usada"], max(x["com"], x["sem"]))
        self.assertEqual(x["compensa"], x["com"] >= x["sem"])

    def test_ascendencia_em_cadeia(self):
        a = self.S("""() => { const asc = __planner.state.ascendencia; asc.linha[0].geracao = 3; asc.linha[0].vivo = 'nao';
          asc.linha.push({ id: 'a2', geracao: 2, nome: 'Avô', portugues: 'nao', vivo: 'nao' }, { id: 'a1', geracao: 1, nome: 'Pai', portugues: 'nao', vivo: 'sim' });
          sincronizarAscendencia(); return analisarAscendencia(); }""")
        self.assertEqual(a["tipo"], "cadeia")
        self.assertEqual(a["passos"][0]["quem"], "Pai")
        self.assertIn("neto", json.dumps(self.S("__planner.state.vistos.ascendencia")))

    def test_documentos_pdf_e_imagem(self):
        pdf, png, _ = gerar_fixtures(self.browser)
        pg = self.pg
        pg.click('#iaFab'); pg.wait_for_timeout(300)
        pg.set_input_files('#iaArquivo', [str(pdf), str(png)]); pg.wait_for_timeout(3000)
        self.assertEqual(len(self.S("[...document.querySelectorAll('#iaAnexos .ia-anexo')]")), 2)
        pg.fill('#iaInput', 'Compare com o plano'); pg.press('#iaInput', 'Enter'); self.esperar_livre(pg)
        reqs = self.S("window.__iaReqs")
        ultima = [m for m in reqs[-1]["messages"] if m["role"] == "user"][-1]["content"]
        self.assertIn("<<<", ultima)
        self.assertIn("Vencimento base", ultima)
        visao = [r for r in reqs if isinstance(r["messages"][0].get("content"), list)]
        self.assertEqual(visao[0]["model"], "qwen/qwen3.8-27b")

    def test_voz(self):
        pg = self.pg
        pg.click('#iaFab'); pg.wait_for_timeout(300)
        pg.click('#iaMic'); pg.wait_for_timeout(2200); pg.click('#iaMic'); pg.wait_for_timeout(1800)
        t = self.S("window.__transc")
        self.assertEqual(t[0]["modelo"], "whisper-large-v3")
        self.assertIn("aluguel for 800", self.S("[...document.querySelectorAll('#iaLog .ia-msg.user')].pop().textContent"))

    def test_regras_vigiadas_e_diario(self):
        pg = self.pg
        pg.click('#nav button[data-view="vasco"]'); pg.wait_for_timeout(500)
        pg.click('#vzRegrasBtn'); pg.wait_for_timeout(1500)
        regras = {r["id"]: r for r in self.S("regrasComValores()")}
        self.assertTrue(regras["salarioMinimo"]["diferente"])
        self.assertFalse(regras["taxaConsular"]["diferente"])
        pg.click('[data-regra="salarioMinimo"]'); pg.wait_for_timeout(300)
        self.assertEqual(self.S("__planner.state.metas.salarioMinimo"), 1020)
        self.assertIn("Regra atualizada", self.S("__planner.state.decisoes.at(-1).texto"))

    def test_plano_de_euros_agenda_e_relatorio(self):
        pg = self.pg
        p = self.S("planoCompraEuros()")
        self.assertGreater(p["meta"], 0)
        self.assertEqual(p["faltam"], p["meta"] - p["comprados"])
        pg.click('#nav button[data-view="checklist"]'); pg.wait_for_timeout(300)
        with pg.expect_download() as d:
            pg.click('#chkIcs')
        with open(d.value.path(), encoding="utf-8") as f:
            ics = f.read()
        self.assertTrue(ics.startswith("BEGIN:VCALENDAR"))
        self.assertGreater(ics.count("BEGIN:VEVENT"), 10)
        self.S("__planner.state.decisoes.push({ id: 'x', data: new Date().toISOString(), texto: 'Teste', origem: 'Você', antes: 1, depois: 2 })")
        self.S("gerarRelatorio()"); pg.wait_for_timeout(800)
        self.assertIn("Decisões registradas", self.S("document.querySelector('#report').innerText"))


if __name__ == "__main__":
    unittest.main()
