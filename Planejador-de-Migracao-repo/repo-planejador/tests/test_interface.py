"""Abas principais, vistos, viagem e o ciclo de ferramentas do Vasco."""
import unittest

from apoio import TesteApp, mock


class Interface(TesteApp):
    def setUp(self):
        self.pg = self.abrir(mock("basico.js"))
        self.S = self.pg.evaluate

    def test_todas_as_abas_abrem(self):
        abas = self.S("[...document.querySelectorAll('#nav button')].map(b => b.dataset.view)")
        self.assertEqual(len(abas), self.S("Object.keys(TITLES).length"))
        for aba in abas:
            self.pg.click(f'#nav button[data-view="{aba}"]')
            self.pg.wait_for_timeout(250)
            self.assertTrue(self.S(f"document.querySelector('#view-{aba}').classList.contains('active')"), aba)

    def test_vistos_escolher_e_custos(self):
        self.pg.click('#nav button[data-view="vistos"]'); self.pg.wait_for_timeout(500)
        antes = self.S("__planner.state.tarefas.filter(t => t.grupo === 'Visto').length")
        self.pg.click('[data-escolher="d7"]'); self.pg.wait_for_timeout(300)
        self.pg.click('#vsDocsBtn'); self.pg.click('#vsCustoBtn'); self.pg.wait_for_timeout(300)
        self.assertGreater(self.S("__planner.state.tarefas.filter(t => t.grupo === 'Visto').length"), antes)
        self.assertEqual(self.S("__planner.state.vistos.escolhido"), "d7")

    def test_viagem_busca_e_usa_no_plano(self):
        self.pg.click('#nav button[data-view="viagem"]'); self.pg.wait_for_timeout(600)
        self.S("""() => { for (const [k, v] of [['travelpayoutsToken', 'abcdef123456'], ['serpapiKey', 'serpkey12345']]) {
          const el = document.querySelector(`[data-k="${k}"]`); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); } }""")
        self.pg.wait_for_timeout(300)
        self.pg.click('#vgBuscar'); self.pg.wait_for_timeout(1500)
        self.pg.click('#vgUsar'); self.pg.wait_for_timeout(300)
        passagem = self.S("__planner.state.entrada.find(e => /passagem/i.test(e.nome))")
        self.assertEqual(passagem["valor"], 3050)  # Google Flights: R$ 6.100 para 2 pessoas
        self.assertIn("feriados", self.S("window.__calls"))

    def test_vasco_ferramentas_e_proposta(self):
        self.pg.click('#iaFab'); self.pg.wait_for_timeout(300)
        self.pg.fill('#iaChave', 'gsk_' + 'A' * 40); self.pg.click('#iaSalvarChave'); self.pg.wait_for_timeout(500)
        self.assertEqual(self.S("__planner.state.config.iaModelo"), "openai/gpt-oss-120b")
        self.pg.fill('#iaInput', 'Meu plano está alinhado com a realidade de hoje?'); self.pg.press('#iaInput', 'Enter')
        self.esperar_livre(self.pg)
        self.pg.click('[data-aplicar]'); self.pg.wait_for_timeout(400)
        self.assertEqual(self.S("__planner.state.cidadesEdit.viseu.t1"), 750)
        self.assertGreaterEqual(self.S("__planner.state.decisoes.length"), 1)

    def test_exportacao_sem_segredos(self):
        self.S("Object.assign(__planner.state.config, { brapiToken: 'x1', travelpayoutsToken: 'x2', serpapiKey: 'x3', ignavKey: 'x4' })")
        c = self.S("copiaSemSegredos()")
        for k in ("brapiToken", "travelpayoutsToken", "serpapiKey", "ignavKey"):
            self.assertEqual(c["config"][k], "")
        self.assertNotIn("assistente", c)


if __name__ == "__main__":
    unittest.main()
