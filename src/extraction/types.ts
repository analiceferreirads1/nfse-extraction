/**
 * Campos extraídos de uma NFS-e. Compartilhado entre o extrator de linha de base
 * e o futuro extrator por IA. `null` significa "não encontrado ou incerto":
 * nunca preencher com valor chutado.
 */
export interface ExtractedFields {
  providerCnpj: string | null;
  providerName: string | null;
  invoiceNumber: string | null;
  /** Formato AAAA-MM-DD. */
  issueDate: string | null;
  amount: number | null;
  description: string | null;
}
