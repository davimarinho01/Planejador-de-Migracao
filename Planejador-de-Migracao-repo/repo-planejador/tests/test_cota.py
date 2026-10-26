"""O Vasco respeitando o limite gratuito da Groq (8 mil tokens por minuto por modelo)."""
import unittest

from apoio import TesteApp, mock, gerar_fixtures


class Cota(TesteApp):
    def setUp(self):
        # janela do simulador reduzida para 8 s, para o teste não demorar minutos
        self.pg = self.abrir(mock("cota.js"), espera=1000)
        self.S = self.pg.evaluate
        self.pg.click('#iaFab'); self.pg.wait_for_timeout(300)

    def ultimas(self, n=2):
        return self.S(f"[...document.querySelectorAll('#iaLog .ia-msg')].slice(-{n}).map(x => x.textContent)")

    def test_espera_o_limite_em_vez_de_falhar(self):
        self.S("(async () => { await window.net.ia.chat({ model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'x'.repeat(23000) }] }); })()")
        self.pg.fill('#iaInput', 'Bom dia Vasco!'); self.pg.press('#iaInput', 'Enter')
        self.esperar_livre(self.pg)
        self.assertEqual(self.ultimas(1), ["Bom dia!"])

    def test_curriculo_longo_cabe_no_limite(self):
        _, _, cv = gerar_fixtures(self.browser)
        self.pg.set_input_files('#iaArquivo', str(cv)); self.pg.wait_for_timeout(400)
        self.pg.fill('#iaInput', 'O que você acha do meu currículo, consigo um emprego em PT?'); self.pg.press('#iaInput', 'Enter')
        self.esperar_livre(self.pg)
        self.assertIn("boa chance", self.ultimas(1)[0])
        log = self.S("window.__log")
        principal = [l for l in log if l[0] == "openai/gpt-oss-120b" and l[2] == 200]
        self.assertTrue(all(l[1] < 6500 for l in principal), principal)
        self.assertTrue(any(l[0] == "openai/gpt-oss-20b" and l[3] == "busca" for l in log), "a pesquisa deve ir para o modelo auxiliar")

    def test_limite_diario_troca_de_modelo_e_avisa(self):
        self.S("window.__bloqueioDiario.add('openai/gpt-oss-120b')")
        self.pg.fill('#iaInput', 'Tudo certo?'); self.pg.press('#iaInput', 'Enter')
        self.esperar_livre(self.pg)
        self.assertIn("respondido com openai/gpt-oss-20b", self.ultimas(1)[0])

    def test_tentar_de_novo(self):
        self.S("['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'].forEach(m => window.__bloqueioDiario.add(m))")
        self.pg.fill('#iaInput', 'Mais uma?'); self.pg.press('#iaInput', 'Enter')
        self.esperar_livre(self.pg)
        self.assertIn("limite diário", self.ultimas(1)[0])
        self.S("window.__bloqueioDiario.clear(); Object.values(window.__ia.cotaIA).forEach(c => { c.bloqueadoAte = 0; })")
        self.pg.click('[data-retry]')
        self.esperar_livre(self.pg)
        self.assertEqual(self.ultimas(1), ["Bom dia!"])


if __name__ == "__main__":
    unittest.main()
