/** @odoo-module */
import { session } from '@web/session';

/**
 * Formate un nombre avec des espaces comme séparateurs de milliers
 * @param {number} value - La valeur à formater
 * @param {object} options - Options de formatage
 * @returns {string} Le nombre formaté
 */
export function formatNumber(value, options = {}) {
    if (!value && value !== 0) return "0";
    
    const defaultOptions = {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
        ...options
    };
    
    return new Intl.NumberFormat('fr-FR', defaultOptions).format(value);
}

/**
 * Formate un montant monétaire avec des espaces comme séparateurs de milliers
 * @param {number} value - La valeur monétaire à formater
 * @param {number} currency_id - L'ID de la devise
 * @returns {string} Le montant formaté avec la devise
 */
export function formatMonetary(value, currency_id) {
    if (!value && value !== 0) value = 0;
    
    // Formatter le nombre avec des espaces comme séparateurs de milliers
    const formattedValue = new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
    
    const currency = session.get_currency(currency_id);
    if (currency) {
        if (currency.position === "after") {
            return formattedValue + " " + currency.symbol;
        } else {
            return currency.symbol + " " + formattedValue;
        }
    }
    return formattedValue;
}

/**
 * Formate un pourcentage avec des espaces comme séparateurs de milliers
 * @param {number} value - La valeur en pourcentage
 * @param {number} decimals - Nombre de décimales (défaut: 1)
 * @returns {string} Le pourcentage formaté
 */
export function formatPercentage(value, decimals = 1) {
    if (!value && value !== 0) return "0%";
    
    const formattedValue = new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(value);
    
    return formattedValue + "%";
}
