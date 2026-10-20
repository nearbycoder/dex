package dev.trydex.android.ui.openui

import com.google.common.truth.Truth.assertThat
import dev.trydex.openui.ActionEvent
import dev.trydex.openui.ActionPlan
import dev.trydex.openui.ActionStep
import dev.trydex.openui.DexLibrary
import dev.trydex.openui.OpenUIError
import dev.trydex.openui.OpenUIParser
import dev.trydex.openui.Undefined
import kotlinx.coroutines.runBlocking
import org.junit.Test

/** The Dex host's rules for generated UIs (openui-block.tsx), which the native card must follow exactly. */
class HostTest {
    @Test fun uiActionMessageHasFormValuesAndContext() {
        val event = ActionEvent(ActionEvent.CONTINUE_CONVERSATION, mapOf("context" to "Selected item: {\"itemIndex\":0}"), "Deploy it", null, "deploy")
        val form = mapOf("deploy" to mapOf("env" to mapOf("value" to "prod")))
        assertThat(modelMessage(event, form)).isEqualTo(
            "[UI action] Deploy it\nForm values: {\"deploy\":{\"env\":{\"value\":\"prod\"}}}\nContext: \"Selected item: {\\\"itemIndex\\\":0}\"",
        )
        assertThat(modelMessage(event.copy(params = emptyMap()), emptyMap<String, Any?>())).isEqualTo("[UI action] Deploy it")
    }

    @Test fun passwordFieldsBecomeSecretPlaceholders() = runBlocking {
        val stored = mutableListOf<Pair<String, String>>()
        val state = mapOf(
            "login" to mapOf(
                "user" to mapOf("value" to "mona", "componentType" to Undefined),
                "token" to mapOf("value" to "hunter2"),
            ),
            "token" to "plain",
        )
        val out = withoutSecrets(state, setOf("token")) { field, value -> stored += field to value; "TOKEN_1" }
        assertThat(stored).containsExactly("token" to "hunter2", "token" to "plain")
        assertThat((out as Map<*, *>)["token"]).isEqualTo("{{secret:TOKEN_1}}")
        assertThat(((out["login"] as Map<*, *>)["token"] as Map<*, *>)["value"]).isEqualTo("{{secret:TOKEN_1}}")
        assertThat(((out["login"] as Map<*, *>)["user"] as Map<*, *>)["value"]).isEqualTo("mona")
    }

    @Test fun savedStateDropsPasswords() {
        val saved = withoutPasswords(mapOf("f" to mapOf("pw" to mapOf("value" to "x"), "name" to mapOf("value" to "y"))), setOf("pw"))
        assertThat(saved).isEqualTo(mapOf("f" to mapOf("name" to mapOf("value" to "y"))))
    }

    @Test fun findsPasswordInputs() {
        val result = OpenUIParser(DexLibrary.catalog).parse(
            """
            root = Card([f])
            f = Form("login", Buttons([Button("Go")]), [FormControl("Token", Input("token", "", "password")), FormControl("Name", Input("name"))])
            """.trimIndent(),
        )
        assertThat(passwordFields(result.root)).containsExactly("token")
    }

    @Test fun mutationOnlyToolsAndRows() {
        val code = """
            root = Card([Table([Col("Title", list.rows.title)]), Button("Stop", @Run(stop))])
            list = Query("app_list_sessions", {})
            stop = Mutation("app_stop_chat", {})
        """.trimIndent()
        val result = OpenUIParser(DexLibrary.catalog).parse(code)
        assertThat(mutationOnlyTools(result)).containsExactly("app_stop_chat")
        assertThat(rowsTools(result, code)).containsExactly("app_list_sessions")
    }

    @Test fun problemsAndToolErrorsAreWordedForTheModel() {
        val errors = listOf(
            OpenUIError(source = "parser", code = "unknown-component", message = "Unknown component Foo", statementId = "x", component = "Foo", hint = "Available components: Card"),
            OpenUIError(source = "parser", code = "excess-args", message = "Too many", severity = "warning"),
            OpenUIError(source = "query", code = "tool-error", message = "Query \"app_list\" failed: boom"),
            OpenUIError(source = "mutation", code = "mcp-error", message = "Mutation \"app_stop\" returned an error: You cancelled it."),
        )
        assertThat(programProblems(errors)).containsExactly("x: Foo Unknown component Foo (Available components: Card)")
        assertThat(toolErrors(errors)).containsExactly("app_list: boom")
        assertThat(fixItMessage(listOf("a", "b"))).isEqualTo("[UI errors] The UI you rendered has problems. Render it again, fixed:\n- a\n- b")
    }

    @Test fun cardRowsFollowTheWebsLayout() {
        assertThat(rowConfiguration(1, 3)).containsExactly(1)
        assertThat(rowConfiguration(4, 3)).containsExactly(2, 2).inOrder()
        assertThat(rowConfiguration(5, 3)).containsExactly(3, 2).inOrder()
        assertThat(rowConfiguration(7, 3)).containsExactly(3, 2, 2).inOrder()
        assertThat(rowConfiguration(8, 3)).containsExactly(3, 2, 3).inOrder()
        assertThat(rowConfiguration(5, 2)).containsExactly(2, 2, 1).inOrder()
    }

    @Test fun cardClicksAddTheItemToToAssistantSteps() {
        val plan = ActionPlan(listOf(ActionStep.ToAssistant("Tell me more"), ActionStep.OpenUrl("https://example.com")))
        val out = withItemContext(plan, mapOf("itemIndex" to 0.0, "itemId" to Undefined, "itemTitle" to "Paris")) as ActionPlan
        assertThat((out.steps[0] as ActionStep.ToAssistant).context).isEqualTo("Selected item: {\"itemIndex\":0,\"itemTitle\":\"Paris\"}")
        assertThat(out.steps[1]).isEqualTo(plan.steps[1])
        val withContext = withItemContext(ActionPlan(listOf(ActionStep.ToAssistant("x", "ctx"))), mapOf("itemIndex" to 1.0)) as ActionPlan
        assertThat((withContext.steps[0] as ActionStep.ToAssistant).context).isEqualTo("ctx\nSelected item: {\"itemIndex\":1}")
    }

    @Test fun imagesLoadOnlyWhereTheWebCspAllows() {
        val server = "https://dex.example/"
        assertThat(imageModel("/api/media/u/x.png", server)).isEqualTo("https://dex.example/api/media/u/x.png")
        assertThat(imageModel("https://dex.example/a.png", server)).isEqualTo("https://dex.example/a.png")
        assertThat(imageModel("https://avatars.githubusercontent.com/u/1", server)).isEqualTo("https://avatars.githubusercontent.com/u/1")
        assertThat(imageModel("https://i.ytimg.com/vi/x/hqdefault.jpg", server)).isNotNull()
        assertThat(imageModel("https://evil.example/leak?chat=secret", server)).isNull()
        assertThat(imageModel("//evil.example/x.png", server)).isNull()
        assertThat(imageModel("javascript:alert(1)", server)).isNull()
        assertThat(imageModel("data:image/png;base64,iVBORw0KGgo=", server)).isInstanceOf(ByteArray::class.java)
        assertThat(safeLink("https://ok.example")).isEqualTo("https://ok.example")
        assertThat(safeLink("javascript:alert(1)")).isNull()
        assertThat(safeLink("file:///etc/passwd")).isNull()
    }

    @Test fun lucideNamesResolve() {
        assertThat(OpenUIIcons.resolve("check-circle")).isEqualTo(OpenUIIcons.resolve("circle-check"))
        assertThat(OpenUIIcons.resolve("TrendingUp")).isEqualTo(OpenUIIcons.resolve("trending-up"))
        assertThat(OpenUIIcons.resolve("arrow-up-right-foo")).isEqualTo(OpenUIIcons.resolve("arrow-up-right"))
        assertThat(OpenUIIcons.resolve("no-such-icon", "weather")).isEqualTo(OpenUIIcons.resolve("cloud"))
        assertThat(OpenUIIcons.resolve("no-such-icon")).isEqualTo(OpenUIIcons.resolve("circle-dot"))
        assertThat(OpenUIIcons.resolve("")).isNull()
    }
}
