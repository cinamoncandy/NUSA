import {
  AiposState,
  DecisionRecord,
  ValidationIssue,
  ValidationReport,
  WorkOrder,
} from "./types";

function pushRequired(issues: ValidationIssue[], path: string, value: string): void {
  if (!value.trim()) {
    issues.push({
      code: "required",
      severity: "error",
      message: `${path} must not be empty`,
      path,
    });
  }
}

export class AiposValidator {
  validateState(state: AiposState): ValidationReport {
    const issues: ValidationIssue[] = [];
    pushRequired(issues, "state.project", state.project);
    pushRequired(issues, "state.phase", state.phase);
    pushRequired(issues, "state.summary", state.summary);

    if (Number.isNaN(Date.parse(state.updatedAt))) {
      issues.push({
        code: "invalid_date",
        severity: "error",
        message: "state.updatedAt must be an ISO-compatible date",
        path: "state.updatedAt",
      });
    }

    return this.report(issues);
  }

  validateWorkOrders(workOrders: readonly WorkOrder[]): ValidationReport {
    const issues: ValidationIssue[] = [];
    const ids = new Set<string>();

    for (const [index, workOrder] of workOrders.entries()) {
      const base = `workOrders[${index}]`;
      pushRequired(issues, `${base}.id`, workOrder.id);
      pushRequired(issues, `${base}.title`, workOrder.title);
      pushRequired(issues, `${base}.objective`, workOrder.objective);

      if (ids.has(workOrder.id)) {
        issues.push({
          code: "duplicate_id",
          severity: "error",
          message: `duplicate work order id: ${workOrder.id}`,
          path: `${base}.id`,
        });
      }
      ids.add(workOrder.id);

      if (workOrder.acceptanceCriteria.length === 0) {
        issues.push({
          code: "missing_acceptance_criteria",
          severity: "error",
          message: `work order ${workOrder.id} must define acceptance criteria`,
          path: `${base}.acceptanceCriteria`,
        });
      }
    }

    for (const [index, workOrder] of workOrders.entries()) {
      for (const dependency of workOrder.dependencies ?? []) {
        if (!ids.has(dependency)) {
          issues.push({
            code: "missing_dependency",
            severity: "error",
            message: `work order ${workOrder.id} depends on unknown work order ${dependency}`,
            path: `workOrders[${index}].dependencies`,
          });
        }
      }
    }

    return this.report(issues);
  }

  validateDecisions(decisions: readonly DecisionRecord[]): ValidationReport {
    const issues: ValidationIssue[] = [];
    const ids = new Set<string>();

    for (const [index, decision] of decisions.entries()) {
      const base = `decisions[${index}]`;
      pushRequired(issues, `${base}.id`, decision.id);
      pushRequired(issues, `${base}.title`, decision.title);
      pushRequired(issues, `${base}.context`, decision.context);
      pushRequired(issues, `${base}.decision`, decision.decision);

      if (ids.has(decision.id)) {
        issues.push({
          code: "duplicate_id",
          severity: "error",
          message: `duplicate decision id: ${decision.id}`,
          path: `${base}.id`,
        });
      }
      ids.add(decision.id);
    }

    return this.report(issues);
  }

  combine(...reports: readonly ValidationReport[]): ValidationReport {
    return this.report(reports.flatMap((report) => report.issues));
  }

  private report(issues: readonly ValidationIssue[]): ValidationReport {
    return {
      valid: !issues.some((issue) => issue.severity === "error"),
      issues,
    };
  }
}
