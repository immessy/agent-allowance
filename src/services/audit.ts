import { randomUUID } from "node:crypto";
import {
  AuditActorSchema,
  AuditEventTypeSchema,
  type AuditActor,
  type AuditEventType,
} from "@/domain/schemas";
import type { AuditEventRecord, Repositories } from "@/infra/db/repositories";

export interface RecordAuditEventInput {
  type: AuditEventType;
  actor: AuditActor;
  purchaseId: string | null;
  summary: string;
  payload?: Record<string, unknown>;
}

export class AuditService {
  constructor(
    private readonly auditRepo: Repositories["audit"],
    private readonly nowFn: () => Date = () => new Date()
  ) {}

  record(input: RecordAuditEventInput): AuditEventRecord {
    const type = AuditEventTypeSchema.parse(input.type);
    const actor = AuditActorSchema.parse(input.actor);
    const event: AuditEventRecord = {
      id: `evt_${randomUUID()}`,
      timestamp: this.nowFn().toISOString(),
      type,
      purchaseId: input.purchaseId,
      actor,
      summary: input.summary.trim(),
      payload: input.payload ?? {},
    };
    return this.auditRepo.insert(event);
  }

  listAll(limit = 500): AuditEventRecord[] {
    return this.auditRepo.list(limit);
  }

  listByPurchaseId(purchaseId: string): AuditEventRecord[] {
    return this.auditRepo.listByPurchaseId(purchaseId);
  }
}

