import type { SaxoClient } from './client.js';

export type PriceAlertComparisonOperator = 'GreaterOrEqual' | 'LessOrEqual';
export type PriceAlertDefinitionState = 'Disabled' | 'Enabled' | 'RecentlyTriggered';
export type PriceVariable = 'AskTick' | 'BidTick' | 'PercentChange' | 'Traded';
export type AlertSound = 'Asterisk' | 'Beep' | 'Exclamation' | 'Hand' | 'None' | 'Question';
export type PriceAlertDefinitionId = string | number;

export interface PriceAlertDefinitionInput {
  AccountId: string;
  AssetType: string;
  Comment?: string;
  ExpiryDate?: string;
  IsExtendedHours?: boolean;
  IsRecurring?: boolean;
  Operator: PriceAlertComparisonOperator;
  PriceVariable: PriceVariable;
  State?: PriceAlertDefinitionState;
  TargetValue: number;
  Uic: number;
}

export interface PriceAlertDefinitionResponse extends PriceAlertDefinitionInput {
  AlertDefinitionId?: PriceAlertDefinitionId;
  ClientId?: string;
  UserId?: string;
}

export interface ListPriceAlertsInput {
  inlinecount?: 'AllPages' | 'None';
  skip?: number;
  top?: number;
  state?: PriceAlertDefinitionState;
}

export interface GetPriceAlertInput {
  alertDefinitionId: PriceAlertDefinitionId;
}

export interface UpdatePriceAlertInput extends Partial<PriceAlertDefinitionInput> {
  AlertDefinitionId: PriceAlertDefinitionId;
}

export interface DeletePriceAlertsInput {
  alertDefinitionIds: PriceAlertDefinitionId[];
}

export interface PriceAlertUserSettingsInput {
  EmailAddress?: string;
  NotifyWithMail?: boolean;
  NotifyWithPopup?: boolean;
  Sound?: AlertSound;
}

export interface PriceAlertUserSettingsResponse extends PriceAlertUserSettingsInput {
  EmailAddressValidated?: boolean;
}

export function listPriceAlerts(client: SaxoClient, input: ListPriceAlertsInput = {}): Promise<unknown> {
  return client.get('/vas/v1/pricealerts/definitions', {
    $inlinecount: input.inlinecount,
    $skip: input.skip,
    $top: input.top,
    State: input.state,
  });
}

export function getPriceAlert(client: SaxoClient, input: GetPriceAlertInput): Promise<PriceAlertDefinitionResponse> {
  return client.get(`/vas/v1/pricealerts/definitions/${formatAlertDefinitionId(input.alertDefinitionId)}`);
}

export function createPriceAlert(
  client: SaxoClient,
  input: PriceAlertDefinitionInput,
): Promise<PriceAlertDefinitionResponse> {
  return client.post('/vas/v1/pricealerts/definitions', input);
}

export async function updatePriceAlert(client: SaxoClient, input: UpdatePriceAlertInput): Promise<unknown> {
  const existing = await getPriceAlert(client, { alertDefinitionId: input.AlertDefinitionId });
  const body: PriceAlertDefinitionInput = {
    AccountId: requiredString(input.AccountId ?? existing.AccountId, 'AccountId'),
    AssetType: requiredString(input.AssetType ?? existing.AssetType, 'AssetType'),
    Comment: input.Comment ?? existing.Comment,
    ExpiryDate: input.ExpiryDate ?? existing.ExpiryDate,
    IsExtendedHours: input.IsExtendedHours ?? existing.IsExtendedHours,
    IsRecurring: input.IsRecurring ?? existing.IsRecurring,
    Operator: requiredEnum(input.Operator ?? existing.Operator, 'Operator'),
    PriceVariable: requiredEnum(input.PriceVariable ?? existing.PriceVariable, 'PriceVariable'),
    State: input.State ?? existing.State,
    TargetValue: requiredNumber(input.TargetValue ?? existing.TargetValue, 'TargetValue'),
    Uic: requiredNumber(input.Uic ?? existing.Uic, 'Uic'),
  };
  return client.put(`/vas/v1/pricealerts/definitions/${formatAlertDefinitionId(input.AlertDefinitionId)}`, body);
}

export function deletePriceAlerts(client: SaxoClient, input: DeletePriceAlertsInput): Promise<unknown> {
  return client.delete(
    `/vas/v1/pricealerts/definitions/${input.alertDefinitionIds.map(formatAlertDefinitionId).join(',')}`,
  );
}

export function getPriceAlertUserSettings(client: SaxoClient): Promise<PriceAlertUserSettingsResponse> {
  return client.get('/vas/v1/pricealerts/usersettings');
}

export async function updatePriceAlertUserSettings(
  client: SaxoClient,
  input: PriceAlertUserSettingsInput,
): Promise<unknown> {
  const existing = await getPriceAlertUserSettings(client);
  const body: PriceAlertUserSettingsInput = {
    EmailAddress: input.EmailAddress ?? existing.EmailAddress,
    NotifyWithMail: input.NotifyWithMail ?? existing.NotifyWithMail,
    NotifyWithPopup: input.NotifyWithPopup ?? existing.NotifyWithPopup,
    Sound: input.Sound ?? existing.Sound,
  };
  return client.put('/vas/v1/pricealerts/usersettings', body);
}

function requiredString(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Cannot update price alert: missing ${name}.`);
  }
  return value;
}

function requiredNumber(value: number | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Cannot update price alert: missing ${name}.`);
  }
  return value;
}

function requiredEnum<T extends string>(value: T | undefined, name: string): T {
  if (!value) {
    throw new Error(`Cannot update price alert: missing ${name}.`);
  }
  return value;
}

function formatAlertDefinitionId(value: PriceAlertDefinitionId): string {
  return encodeURIComponent(String(value));
}
