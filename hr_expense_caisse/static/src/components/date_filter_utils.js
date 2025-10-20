/** @odoo-module */

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

// Fonction pour effacer les filtres de date
function clearDateFilters() {
    // Trouver les champs de date
    const dateFromField = document.querySelector('input[name="date_from"]');
    const dateToField = document.querySelector('input[name="date_to"]');
    
    // Effacer les valeurs visuellement
    if (dateFromField) {
        dateFromField.value = '';
        dateFromField.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    if (dateToField) {
        dateToField.value = '';
        dateToField.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    // Afficher une notification
    const notification = useService("notification");
    notification.add("Filtres de date effacés avec succès!", {
        type: "success",
    });
}

// Enregistrer la fonction dans le registre Odoo
registry.category("hr_expense_caisse_utils").add("clearDateFilters", clearDateFilters);
