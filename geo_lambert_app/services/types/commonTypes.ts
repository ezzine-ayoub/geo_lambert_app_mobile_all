// ==================== TYPES COMMUNS POUR TOUS LES SERVICES ====================

/**
 * Structure d'un follower de message (mail.followers)
 * Note: message_follower_ids est un ARRAY (Many2many) avec BZAAAAF de followers
 * Et partner_id est aussi un ARRAY avec UN SEUL objet (Many2one avec replaceToObject)
 */
export interface MessageFollower {
  id: number;
  partner_id: Array<{  // ⚠️ C'est un ARRAY, pas un objet simple!
    id: number;
    name: string;
    display_name: string;
  }>;
  name?: string;
  display_name?: string;
}


