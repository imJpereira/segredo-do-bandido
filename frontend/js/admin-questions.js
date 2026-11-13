import {
  createQuestion,
  deleteQuestion,
  listQuestions,
  updateQuestion,
} from "./api.js";
import { getState } from "./state.js";

const OPTION_COUNT = 4;

export function setupAdminQuestions() {
  const form = document.getElementById("question-form");
  if (!form) {
    return;
  }

  const passwordInput = document.getElementById("admin-password");
  const questionInput = document.getElementById("question-text");
  const optionInputs = [
    document.getElementById("option-a"),
    document.getElementById("option-b"),
    document.getElementById("option-c"),
    document.getElementById("option-d"),
  ];
  const correctRadios = Array.from(document.querySelectorAll("input[name='correct-option']"));
  const validationFeedback = document.getElementById("question-validation-feedback");
  const apiFeedback = document.getElementById("question-api-feedback");
  const listFeedback = document.getElementById("questions-list-feedback");
  const listContainer = document.getElementById("questions-list");
  const submitButton = document.getElementById("question-submit");
  const cancelButton = document.getElementById("question-cancel");
  const refreshButton = document.getElementById("questions-refresh");

  let editingQuestionId = null;

  function setFeedback(node, message, tone = "") {
    node.textContent = message;
    node.classList.remove("feedback-success", "feedback-error");
    if (tone) {
      node.classList.add(tone);
    }
  }

  function setFormDisabled(disabled) {
    const controls = [passwordInput, questionInput, ...optionInputs, ...correctRadios, submitButton, cancelButton];
    controls.forEach((control) => {
      control.disabled = disabled;
    });
  }

  function clearCorrectSelection() {
    correctRadios.forEach((radio) => {
      radio.checked = false;
    });
  }

  function resetForm() {
    editingQuestionId = null;
    form.reset();
    clearCorrectSelection();
    submitButton.textContent = "Salvar Pergunta";
    setFeedback(validationFeedback, "");
    setFeedback(apiFeedback, "");
  }

  function currentPayload() {
    const questionText = questionInput.value.trim();
    const options = optionInputs.map((input) => input.value.trim());
    const selected = correctRadios.find((radio) => radio.checked);
    const correctIndex = selected ? Number(selected.value) : -1;
    return { questionText, options, correctIndex };
  }

  function validatePayload() {
    const { questionText, options, correctIndex } = currentPayload();

    if (!passwordInput.value.trim()) {
      return "A senha de administração é obrigatória.";
    }
    if (!questionText) {
      return "O enunciado da pergunta é obrigatório.";
    }
    if (options.length !== OPTION_COUNT || options.some((option) => !option)) {
      return "Preencha exatamente 4 opções com texto.";
    }
    if (correctIndex < 0 || correctIndex > 3) {
      return "Selecione exatamente 1 alternativa correta.";
    }
    return "";
  }

  function buildRequestBody() {
    const { questionText, options, correctIndex } = currentPayload();
    return {
      text: questionText,
      options: options.map((text, index) => ({
        text,
        is_correct: index === correctIndex,
      })),
    };
  }

  function renderQuestions(questions) {
    if (!questions.length) {
      listContainer.innerHTML = "";
      setFeedback(listFeedback, "Nenhuma pergunta cadastrada.", "feedback-error");
      return;
    }

    setFeedback(listFeedback, `${questions.length} pergunta(s) carregada(s).`, "feedback-success");
    listContainer.innerHTML = questions
      .map((question) => {
        const options = question.options
          .map((option, index) => `<li>${String.fromCharCode(65 + index)} · ${escapeHtml(option.text)}</li>`)
          .join("");
        return `
          <article class="question-item" data-question-id="${question.id}">
            <p class="question-item-text">${escapeHtml(question.text)}</p>
            <ol class="question-item-options">${options}</ol>
            <div class="question-item-actions">
              <button class="button button-secondary" data-action="edit" type="button">Editar</button>
              <button class="button button-danger" data-action="delete" type="button">Remover</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function reloadQuestions() {
    setFeedback(listFeedback, "Carregando perguntas...");
    refreshButton.disabled = true;
    try {
      const questions = await listQuestions(getState().apiBaseUrl);
      renderQuestions(questions);
    } catch (error) {
      listContainer.innerHTML = "";
      setFeedback(listFeedback, error.message, "feedback-error");
    } finally {
      refreshButton.disabled = false;
    }
  }

  async function submitQuestion(event) {
    event.preventDefault();

    const validationMessage = validatePayload();
    if (validationMessage) {
      setFeedback(validationFeedback, validationMessage, "feedback-error");
      return;
    }

    setFeedback(validationFeedback, "✓ Pergunta válida!", "feedback-success");
    setFeedback(apiFeedback, editingQuestionId ? "Atualizando pergunta..." : "Salvando pergunta...");
    setFormDisabled(true);

    try {
      const password = passwordInput.value.trim();
      const body = buildRequestBody();
      if (editingQuestionId) {
        await updateQuestion(getState().apiBaseUrl, password, editingQuestionId, body);
        setFeedback(apiFeedback, "Pergunta atualizada com sucesso.", "feedback-success");
      } else {
        await createQuestion(getState().apiBaseUrl, password, body);
        setFeedback(apiFeedback, "Pergunta salva com sucesso.", "feedback-success");
      }
      resetForm();
      await reloadQuestions();
    } catch (error) {
      setFeedback(apiFeedback, error.message, "feedback-error");
    } finally {
      setFormDisabled(false);
    }
  }

  async function onListAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    const item = event.target.closest(".question-item");
    if (!item) {
      return;
    }

    const questionId = Number(item.dataset.questionId);
    if (!questionId) {
      return;
    }

    const action = button.dataset.action;
    if (action === "delete") {
      if (!window.confirm("Confirma remover esta pergunta?")) {
        return;
      }
      if (!passwordInput.value.trim()) {
        setFeedback(apiFeedback, "Informe a senha de administração para remover.", "feedback-error");
        return;
      }

      button.disabled = true;
      setFeedback(apiFeedback, "Removendo pergunta...");
      try {
        await deleteQuestion(getState().apiBaseUrl, passwordInput.value.trim(), questionId);
        setFeedback(apiFeedback, "Pergunta removida com sucesso.", "feedback-success");
        if (editingQuestionId === questionId) {
          resetForm();
        }
        await reloadQuestions();
      } catch (error) {
        setFeedback(apiFeedback, error.message, "feedback-error");
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === "edit") {
      const questions = await listQuestions(getState().apiBaseUrl).catch(() => []);
      const question = questions.find((entry) => entry.id === questionId);
      if (!question) {
        setFeedback(apiFeedback, "Pergunta não encontrada para edição.", "feedback-error");
        return;
      }
      editingQuestionId = question.id;
      questionInput.value = question.text;
      optionInputs.forEach((input, index) => {
        input.value = question.options[index]?.text || "";
      });
      clearCorrectSelection();
      submitButton.textContent = "Salvar Edição";
      setFeedback(
        apiFeedback,
        "Reedição iniciada. Selecione novamente a alternativa correta para salvar.",
      );
      setFeedback(validationFeedback, "Selecione 1 alternativa correta para concluir a edição.");
      window.scrollTo({ top: form.offsetTop - 20, behavior: "smooth" });
    }
  }

  form.addEventListener("submit", submitQuestion);
  cancelButton.addEventListener("click", resetForm);
  refreshButton.addEventListener("click", reloadQuestions);
  listContainer.addEventListener("click", onListAction);
  reloadQuestions();
}
