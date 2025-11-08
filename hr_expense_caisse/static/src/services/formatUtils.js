/** @odoo-module */
import { formatCurrency } from '@web/core/utils/numbers';
import { session } from '@web/session';

/**
 * Format a monetary value with spaces
 * @param {number} value - The value to format
 * @param {number} currency_id - Currency ID (default: 1)
 * @returns {string} Formatted currency string
 */
export function formatMonetaryWithSpaces(value, currency_id = 1) {
    try {
        if (!value && value !== 0) value = 0;
        
        // Use Odoo 18 API for monetary formatting
        try {
            return formatCurrency(value, currency_id);
        } catch (formatError) {
            // Fallback with manual formatting
            const formattedValue = new Intl.NumberFormat('fr-FR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(value);
            
            // Try to access currencies via session
            if (session.currencies && session.currencies[currency_id]) {
                const currency = session.currencies[currency_id];
                if (currency.position === "after") {
                    return formattedValue + " " + currency.symbol;
                } else {
                    return currency.symbol + " " + formattedValue;
                }
            }
            
            return formattedValue + " DH";
        }
    } catch (error) {
        return (value || 0).toFixed(2) + " DH";
    }
}
