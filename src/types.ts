
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
  pieces: ServicePiece[];
  includePartsValue: boolean;
  partsValue: number;
  includeLaborValue: boolean;
  laborValue: number;
  includeMaterialsValue: boolean;
  materialsValue: number;
  totalValue: number;
  observations: string;
  createdAt: string;
  updatedAt: string;
}
