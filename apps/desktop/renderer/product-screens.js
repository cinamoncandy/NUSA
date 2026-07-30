/*
 * DOKKAEBI productization screens (WO-0034-A4O req 11).
 *
 * Four small screens, deliberately not a redesign: the first-run safety notice, settings,
 * About, and the shutdown progress overlay. The existing dashboard is untouched.
 *
 * Constraints carried over from the rest of this renderer:
 *   - no innerHTML and no inline style attributes, so the strict CSP needs no relaxing;
 *   - no raw IPC channel names -- only the fixed methods on the preload bridge;
 *   - no absolute path is ever rendered. The About screen opens folders by KEY, so a
 *     screenshot of it cannot carry the account name of whoever took it.
 *
 * The first-run notice is modal and blocking on purpose. It is the one screen a user must
 * pass through, and a dismissible banner would be read by nobody.
 */
(function initialiseProductScreens(globalScope) {
  "use strict";

  const doc = globalScope.document;

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function row(label, value) {
    const node = element("div", "product-row");
    const valueText = element("span", "product-row__value", value);
    const stringValue = String(value ?? "");
    if (stringValue.length > 28) {
      valueText.title = stringValue;
      valueText.classList.add("product-row__value--long");
      const copy = element("button", "product-row__copy", "복사");
      copy.type = "button";
      copy.setAttribute("aria-label", `${label} 복사`);
      copy.setAttribute("data-copy-value", stringValue);
      node.append(element("span", "product-row__label", label), valueText, copy);
    } else {
      node.append(element("span", "product-row__label", label), valueText);
    }
    return node;
  }

  const LOG_LEVEL_LABEL = { ERROR: "오류만", WARN: "경고 이상", INFO: "일반 (권장)", DEBUG: "상세 (개발용)" };
  const THEME_LABEL = { SYSTEM: "시스템 설정 따름", DARK: "어두운 테마", LIGHT: "밝은 테마" };
  const STEP_STATUS_LABEL = { PENDING: "대기", RUNNING: "진행 중", DONE: "완료", FAILED: "실패" };

  /**
   * The blocking safety notice. Returns a controller rather than rendering immediately: the
   * caller asks the main process whether it is required, and a notice that is not required
   * is never built at all.
   */
  function createFirstRunNotice(options) {
    const api = options.api;
    const onAcknowledged = options.onAcknowledged || function () {};
    const overlay = element("div", "product-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "product-first-run-title");
    const card = element("section", "product-card product-card--notice");
    const title = element("h2", "product-card__title", "시작하기 전에 확인해 주세요");
    title.id = "product-first-run-title";
    const list = element("ul", "product-notice__list");
    const paths = element("div", "product-notice__paths");
    const error = element("p", "product-error");
    error.setAttribute("role", "alert");
    const confirm = element("button", "ui-button ui-button--primary", "확인했습니다");
    confirm.type = "button";
    const actions = element("div", "product-card__actions");
    actions.append(confirm);
    card.append(title, list, paths, error, actions);
    overlay.append(card);

    function render(notice) {
      list.replaceChildren(...notice.statements.map(function (statement) {
        const item = element("li", "product-notice__item");
        item.append(element("span", "product-notice__mark", "✔"), element("span", "product-notice__text", statement.text));
        return item;
      }));
      paths.replaceChildren(
        element("p", "product-notice__paths-title", "기록이 저장되는 곳"),
        row("현재 모드", notice.mode),
        row("Evidence", "앱 데이터 폴더 안의 shadow-evidence"),
        row("로그", "앱 데이터 폴더 안의 logs")
      );
    }

    confirm.addEventListener("click", async function () {
      confirm.disabled = true;
      error.textContent = "";
      try {
        await api.acknowledgeFirstRun();
        overlay.remove();
        onAcknowledged();
      } catch (cause) {
        // Re-enabled so the user is not trapped behind a transient failure.
        confirm.disabled = false;
        error.textContent = cause && cause.message ? cause.message : "확인을 저장하지 못했습니다.";
      }
    });

    return {
      element: overlay,
      render: render,
      /** Shows only when the main process says it is required. The renderer never decides. */
      async mount(root) {
        const state = await api.firstRun();
        if (!state || !state.required) return false;
        render(state.notice);
        if (state.reason === "SAFETY_POLICY_CHANGED") {
          title.textContent = "안전 정책이 바뀌었습니다. 다시 확인해 주세요";
        }
        root.append(overlay);
        confirm.focus();
        return true;
      }
    };
  }

  /** Settings. Credentials are write-only from the renderer and never returned by the main process. */
  function createSettingsPanel(options) {
    const api = options.api;
    const panel = element("section", "product-card");
    const title = element("h2", "product-card__title", "설정");
    const form = element("div", "product-form");
    const status = element("p", "product-status");
    status.setAttribute("role", "status");
    const error = element("p", "product-error");
    error.setAttribute("role", "alert");
    let current = null;

    function select(id, labelText, values, labels) {
      const label = element("label", "product-field__label", labelText);
      label.htmlFor = id;
      const control = doc.createElement("select");
      control.id = id;
      control.className = "product-field__control";
      for (const value of values) {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = labels[value] || value;
        control.append(option);
      }
      const field = element("div", "product-field");
      field.append(label, control);
      return { field: field, control: control };
    }

    const theme = select("product-theme", "테마", ["SYSTEM", "DARK", "LIGHT"], THEME_LABEL);
    const level = select("product-log-level", "로그 상세도", ["ERROR", "WARN", "INFO", "DEBUG"], LOG_LEVEL_LABEL);
    const retentionLabel = element("label", "product-field__label", "로그 보관 기간 (일)");
    retentionLabel.htmlFor = "product-log-retention";
    const retention = doc.createElement("input");
    retention.id = "product-log-retention";
    retention.className = "product-field__control";
    retention.type = "number";
    retention.min = "1";
    retention.max = "90";
    retention.step = "1";
    const retentionField = element("div", "product-field");
    retentionField.append(retentionLabel, retention);

    function toggle(id, labelText) {
      const control = doc.createElement("input");
      control.id = id;
      control.type = "checkbox";
      control.className = "product-field__checkbox";
      const label = element("label", "product-field__label", labelText);
      label.htmlFor = id;
      const field = element("div", "product-field product-field--inline");
      field.append(control, label);
      return { field: field, control: control };
    }

    const diagnostics = toggle("product-show-diagnostics", "진단 정보 표시");
    const notifications = toggle("product-show-notifications", "알림 표시");

    const credentialTitle = element("h3", "product-card__subtitle", "Upbit 조회 전용 연결");
    const credentialNote = element("p", "product-note", "조회 권한만 사용합니다. 주문·취소·출금 API는 이 앱에 없습니다.");
    const accessKey = doc.createElement("input");
    accessKey.id = "upbit-access-key"; accessKey.className = "product-field__control"; accessKey.type = "text"; accessKey.autocomplete = "off";
    const accessLabel = element("label", "product-field__label", "Access Key"); accessLabel.htmlFor = accessKey.id;
    const accessField = element("div", "product-field"); accessField.append(accessLabel, accessKey);
    const secretKey = doc.createElement("input");
    secretKey.id = "upbit-secret-key"; secretKey.className = "product-field__control"; secretKey.type = "password"; secretKey.autocomplete = "new-password";
    const secretLabel = element("label", "product-field__label", "Secret Key"); secretLabel.htmlFor = secretKey.id;
    const secretField = element("div", "product-field"); secretField.append(secretLabel, secretKey);
    const credentialStatus = element("p", "product-status", "연결 정보 없음"); credentialStatus.id = "upbit-credential-status";
    const credentialSave = element("button", "ui-button ui-button--secondary", "조회 연결 저장"); credentialSave.type = "button";
    const credentialTest = element("button", "ui-button ui-button--secondary", "연결 테스트"); credentialTest.type = "button";
    const credentialSnapshot = element("button", "ui-button ui-button--secondary", "계정 스냅샷 조회"); credentialSnapshot.type = "button";
    const credentialReconcile = element("button", "ui-button ui-button--secondary", "스냅샷 대조"); credentialReconcile.type = "button";
    const credentialDelete = element("button", "ui-button ui-button--secondary", "저장 정보 삭제"); credentialDelete.type = "button";
    const credentialActions = element("div", "product-card__actions"); credentialActions.append(credentialSave, credentialTest, credentialSnapshot, credentialReconcile, credentialDelete);

    const save = element("button", "ui-button ui-button--primary", "저장");
    save.type = "button";
    const reset = element("button", "ui-button ui-button--secondary", "설정 초기화");
    reset.type = "button";
    const showNotice = element("button", "ui-button ui-button--secondary", "첫 실행 안내 다시 보기");
    showNotice.type = "button";
    const actions = element("div", "product-card__actions");
    actions.append(save, reset, showNotice);

    const note = element("p", "product-note", "초기화는 화면 설정과 첫 실행 확인만 지웁니다. Evidence, 복구 기록, 감사 로그는 지워지지 않습니다.");
    form.append(theme.field, level.field, retentionField, diagnostics.field, notifications.field, credentialTitle, credentialNote, accessField, secretField, credentialStatus, credentialActions);
    panel.append(title, form, actions, note, status, error);

    function apply(payload) {
      current = payload.settings;
      theme.control.value = current.theme;
      level.control.value = current.logLevel;
      retention.value = String(current.logRetentionDays);
      diagnostics.control.checked = current.showDiagnostics;
      notifications.control.checked = current.showNotifications;
      // A packaged build clamps DEBUG to INFO. Saying so beats silently changing the choice.
      const clamped = payload.maximumLogLevel && payload.maximumLogLevel !== "DEBUG";
      status.textContent = clamped ? "배포 빌드에서는 로그 상세도가 " + (LOG_LEVEL_LABEL[payload.maximumLogLevel] || payload.maximumLogLevel) + " 까지만 적용됩니다." : "";
    }

    function collect() {
      return {
        theme: theme.control.value,
        logLevel: level.control.value,
        logRetentionDays: Number(retention.value),
        showDiagnostics: diagnostics.control.checked,
        showNotifications: notifications.control.checked
      };
    }

    async function run(action, confirmText) {
      error.textContent = "";
      if (confirmText && !globalScope.confirm(confirmText)) return;
      save.disabled = true;
      reset.disabled = true;
      try {
        apply(await action());
        status.textContent = "저장했습니다.";
      } catch (cause) {
        error.textContent = cause && cause.message ? cause.message : "설정을 저장하지 못했습니다.";
      } finally {
        save.disabled = false;
        reset.disabled = false;
      }
    }

    save.addEventListener("click", function () { void run(function () { return api.saveSettings(collect()); }); });
    reset.addEventListener("click", function () {
      void run(function () { return api.resetSettings(); }, "화면 설정과 첫 실행 확인만 초기화됩니다. Evidence와 복구 기록은 그대로 유지됩니다. 계속할까요?");
    });
    showNotice.addEventListener("click", function () {
      // Re-showing is a read of the stored notice, not an un-acknowledgement: the record of
      // what the user confirmed, and when, is not rewritten by looking at it again.
      if (options.onShowNotice) options.onShowNotice();
    });
    async function refreshCredentialStatus() {
      if (!api.upbitCredentials) return;
      const value = await api.upbitCredentials.getStatus();
      credentialStatus.textContent = value.configured ? `저장됨: ${value.accessKeyHint}` : "저장된 조회 연결 없음";
    }
    credentialSave.addEventListener("click", function () {
      void (async () => {
        try {
          credentialSave.disabled = true;
          await api.upbitCredentials.save({ accessKey: accessKey.value, secretKey: secretKey.value });
          accessKey.value = ""; secretKey.value = "";
          await refreshCredentialStatus();
          status.textContent = "조회 전용 연결을 저장했습니다.";
        } catch (cause) { error.textContent = cause && cause.message ? cause.message : "조회 연결을 저장하지 못했습니다."; }
        finally { credentialSave.disabled = false; }
      })();
    });
    credentialTest.addEventListener("click", function () {
      void (async () => {
        try { credentialTest.disabled = true; const result = await api.upbitReadOnly.testConnection(); credentialStatus.textContent = result.message || result.code || "연결 결과를 받았습니다."; }
        catch (cause) { error.textContent = cause && cause.message ? cause.message : "연결 테스트에 실패했습니다."; }
        finally { credentialTest.disabled = false; }
      })();
    });
    credentialSnapshot.addEventListener("click", function () {
      void (async () => {
        try { credentialSnapshot.disabled = true; const result = await api.upbitReadOnly.getSnapshot(); credentialStatus.textContent = result.ok ? `스냅샷 ${result.data.accounts.length}개 자산, 미체결 ${result.data.openOrders.length}건 (${result.observedAt})` : `${result.code}: ${result.message}`; }
        catch (cause) { error.textContent = cause && cause.message ? cause.message : "계정 스냅샷을 조회하지 못했습니다."; }
        finally { credentialSnapshot.disabled = false; }
      })();
    });
    credentialReconcile.addEventListener("click", function () {
      void (async () => {
        try { credentialReconcile.disabled = true; const result = await api.upbitReadOnly.reconcile(); credentialStatus.textContent = result.ok ? `대조 ${result.data.status}: ${result.data.reason}` : `${result.code}: ${result.message}`; }
        catch (cause) { error.textContent = cause && cause.message ? cause.message : "계정 대조를 수행하지 못했습니다."; }
        finally { credentialReconcile.disabled = false; }
      })();
    });
    credentialDelete.addEventListener("click", function () {
      void (async () => { try { await api.upbitCredentials.delete(); await refreshCredentialStatus(); status.textContent = "조회 연결 정보를 삭제했습니다."; } catch (cause) { error.textContent = cause && cause.message ? cause.message : "조회 연결 정보를 삭제하지 못했습니다."; } })();
    });

    return {
      element: panel,
      async refresh() {
        try {
          apply(await api.settings());
          await refreshCredentialStatus();
        } catch (cause) {
          error.textContent = cause && cause.message ? cause.message : "설정을 불러오지 못했습니다.";
        }
      },
      current() { return current; }
    };
  }

  /** About and diagnostics export. Folder buttons send a key; no path is ever displayed. */
  function createAboutPanel(options) {
    const api = options.api;
    const panel = element("section", "product-card");
    const title = element("h2", "product-card__title", "앱 정보");
    const grid = element("div", "product-grid");
    const safety = element("p", "product-badge", "LIVE TRADING DISABLED");
    const folders = element("div", "product-card__actions");
    const exportButton = element("button", "ui-button ui-button--primary", "진단 정보 내보내기");
    exportButton.type = "button";
    const exportResult = element("p", "product-status");
    exportResult.setAttribute("role", "status");
    const error = element("p", "product-error");
    error.setAttribute("role", "alert");
    const exportActions = element("div", "product-card__actions");
    exportActions.append(exportButton);
    panel.append(title, safety, grid, folders, exportActions, exportResult, error);

    exportButton.addEventListener("click", async function () {
      exportButton.disabled = true;
      error.textContent = "";
      exportResult.textContent = "진단 정보를 모으는 중입니다…";
      try {
        const result = await api.exportDiagnostics();
        const withheld = result.manifest && result.manifest.withheldFields ? result.manifest.withheldFields.length : 0;
        exportResult.textContent = "저장했습니다: " + result.fileName + " (" + Math.max(1, Math.round(result.byteLength / 1024)) + " KB"
          + (withheld > 0 ? ", 민감 항목 " + withheld + "건 제외" : "") + ")";
      } catch (cause) {
        exportResult.textContent = "";
        error.textContent = cause && cause.message ? cause.message : "진단 정보를 내보내지 못했습니다.";
      } finally {
        exportButton.disabled = false;
      }
    });

    return {
      element: panel,
      async refresh() {
        try {
          const payload = await api.about();
          const about = payload.about;
          grid.replaceChildren(
            row("앱 이름", about.appName),
            row("버전", about.appVersion),
            row("빌드", about.buildNumber || "(없음)"),
            row("커밋", about.commitSha || "(없음)"),
            row("Electron", about.electronVersion || "(없음)"),
            row("Node", about.nodeVersion),
            row("운영체제", about.operatingSystem + " (" + about.architecture + ")"),
            row("환경", about.environment),
            row("모드", about.mode),
            row("실제 주문", about.liveTradingDisabled ? "비활성" : "활성"),
            row("Private API", about.privateApiDisabled ? "사용 안 함" : "사용"),
            row("자격 증명 저장", about.credentialStorageDisabled ? "안 함" : "함"),
            row("업데이트 채널", payload.update.channel + " · 자동 업데이트 " + (payload.update.automaticUpdatesEnabled ? "켜짐" : "꺼짐")),
            row("서명", payload.update.requiresSignedArtifact ? "서명된 파일만 설치" : "확인 안 함"),
            row("라이선스", about.license),
            row("저작권", about.copyright)
          );
          folders.replaceChildren(...about.folders.map(function (folder) {
            const button = element("button", "ui-button ui-button--secondary", folder.label + " 열기");
            button.type = "button";
            button.addEventListener("click", function () {
              // The KEY travels, never a path.
              api.openFolder(folder.key).catch(function (cause) {
                error.textContent = cause && cause.message ? cause.message : "폴더를 열지 못했습니다.";
              });
            });
            return button;
          }));
        } catch (cause) {
          error.textContent = cause && cause.message ? cause.message : "앱 정보를 불러오지 못했습니다.";
        }
      }
    };
  }

  /**
   * The shutdown overlay. Appears when the main process starts sealing and shows each step,
   * so a slow quit reads as work in progress rather than a frozen window.
   *
   * There is no cancel and no force-quit control here. Neither exists in the main process,
   * and offering one would only let a user skip the evidence seal.
   */
  function createShutdownOverlay(options) {
    const api = options.api;
    const overlay = element("div", "product-overlay");
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-live", "assertive");
    const card = element("section", "product-card product-card--shutdown");
    const title = element("h2", "product-card__title", "안전하게 종료하는 중입니다");
    const hint = element("p", "product-note", "강제로 종료하지 마십시오. 기록을 마무리하고 있습니다.");
    const steps = element("ol", "product-steps");
    const summary = element("p", "product-status");
    card.append(title, hint, steps, summary);
    overlay.append(card);
    let attached = false;

    function render(progress) {
      if (!progress || progress.phase === "IDLE") return;
      if (!attached) {
        (options.root || doc.body).append(overlay);
        attached = true;
      }
      steps.replaceChildren(...progress.steps.map(function (step) {
        const item = element("li", "product-steps__item");
        item.append(
          element("span", "product-steps__label", step.label),
          element("span", "product-steps__status", STEP_STATUS_LABEL[step.status] || step.status)
        );
        if (step.detail) item.append(element("span", "product-steps__detail", step.detail));
        return item;
      }));
      if (progress.phase === "COMPLETE") {
        title.textContent = "정상적으로 종료했습니다";
        hint.textContent = "";
        summary.textContent = "Evidence 저장 완료 · 복구 기록 완료 · 정상 종료 기록됨";
      } else if (progress.phase === "FAILED") {
        title.textContent = "종료 중 일부 단계가 실패했습니다";
        hint.textContent = "증거 폴더를 지우지 마시고 화면 내용을 알려주세요.";
        summary.textContent = "다음 실행에서 복구 절차가 실행됩니다.";
      } else {
        summary.textContent = progress.observationWasRunning ? "관측 중이던 세션을 마무리하고 있습니다." : "";
      }
    }

    return {
      element: overlay,
      render: render,
      listen() {
        if (api.onShutdown) api.onShutdown(render);
      },
      async refresh() {
        try { render(await api.shutdownProgress()); } catch (cause) { void cause; }
      }
    };
  }

  globalScope.DokkaebiProductScreens = {
    createFirstRunNotice: createFirstRunNotice,
    createSettingsPanel: createSettingsPanel,
    createAboutPanel: createAboutPanel,
    createShutdownOverlay: createShutdownOverlay
  };
})(window);
