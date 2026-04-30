
export type ServiceStatus = 'em_espera' | 'na_oficina' | 'finalizado';

export interface MaterialItem {
  id: string;
  name: string;
  price: number;
}

export interface ServicePiece {
  id: string;
  label: string;
  selected: boolean;
  description: string;
  audioBlob?: string; // Base64 encoded for simplicity in local storage
}

export interface NoteData {
  id: string;
  userId: string;
  customerName: string;
  vehicleNameColor: string;
  plate: string;
  cpfCnpj: string;
  whatsapp: string;
  status: ServiceStatus;
  arrivalDate?: string;
  pieces: ServicePiece[];
  includePartsValue: boolean;
  partsValue: number;
  includeLaborValue: boolean;
  laborValue: number;
  includeMaterialsValue: boolean;
  materialsValue: number;
  onlyTotalValue: boolean; // Just total value in finance
  totalValue: number;
  materialItems: MaterialItem[]; // Detailing parts/materials
  observations: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
}
