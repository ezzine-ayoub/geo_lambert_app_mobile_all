from odoo import models, api
import logging

_logger = logging.getLogger(__name__)


class HrExpenseAccountMonth(models.Model):
    _inherit = 'hr.expense.account.month'

    def _prepare_month_payload(self):
        """
        Prépare le payload pour la notification WebSocket du mois
        """
        self.ensure_one()
        
        # Récupérer les transactions du mois
        transactions_list = []
        if hasattr(self, 'transaction_ids') and self.transaction_ids:
            for transaction in self.transaction_ids:
                trans_data = {
                    'id': transaction.id,
                    'name': transaction.name or '',
                    'display_name': transaction.display_name or '',
                    'balance': transaction.balance if hasattr(transaction, 'balance') else 0.0,
                    'solde_amount': transaction.solde_amount if hasattr(transaction, 'solde_amount') else 0.0,
                    'expense_move_type': transaction.expense_move_type if hasattr(transaction, 'expense_move_type') else 'spent',
                    'date': transaction.date.isoformat() if transaction.date else False,
                    'description': transaction.description if hasattr(transaction, 'description') else False,
                    'create_date': transaction.create_date.isoformat() if transaction.create_date else False,
                    'write_date': transaction.write_date.isoformat() if transaction.write_date else False,
                }
                
                # Ajouter l'utilisateur s'il existe
                if hasattr(transaction, 'user_id') and transaction.user_id:
                    trans_data['user_id'] = [
                        transaction.user_id.id,
                        transaction.user_id.name
                    ]
                
                # Ajouter les champs optionnels s'ils existent
                if hasattr(transaction, 'expense_type_id') and transaction.expense_type_id:
                    trans_data['expense_type_id'] = [
                        transaction.expense_type_id.id,
                        transaction.expense_type_id.name
                    ]
                
                if hasattr(transaction, 'expense_category_id') and transaction.expense_category_id:
                    trans_data['expense_category_id'] = [
                        transaction.expense_category_id.id,
                        transaction.expense_category_id.name
                    ]
                
                if hasattr(transaction, 'project_id') and transaction.project_id:
                    trans_data['project_id'] = [
                        transaction.project_id.id,
                        transaction.project_id.name
                    ]
                
                if hasattr(transaction, 'task_id') and transaction.task_id:
                    trans_data['task_id'] = [
                        transaction.task_id.id,
                        transaction.task_id.name
                    ]
                
                if hasattr(transaction, 'currency_id') and transaction.currency_id:
                    trans_data['currency_id'] = [
                        transaction.currency_id.id,
                        transaction.currency_id.name
                    ]
                
                transactions_list.append(trans_data)
        
        # Construire le payload du mois
        return {
            'id': self.id,
            'name': self.name or '',
            'display_name': self.display_name or self.name or '',
            'caisse_id': [self.caisse_id.id, self.caisse_id.name] if self.caisse_id else False,
            'sold': self.sold if hasattr(self, 'sold') else 0.0,
            'solde_initial': self.solde_initial if hasattr(self, 'solde_initial') else 0.0,
            'solde_final': self.solde_final if hasattr(self, 'solde_final') else 0.0,
            'transaction_ids': transactions_list,
            'create_date': self.create_date.isoformat() if self.create_date else False,
            'write_date': self.write_date.isoformat() if self.write_date else False,
        }

    def _send_month_notification(self, event_type='updated'):
        """
        Envoie une notification WebSocket pour les changements de mois
        Canal privé: geo_lambert_expense_month_caisse_{case_id}_{user_id}
        """
        for month in self:
            try:
                # Récupérer case_id et user_id
                case_id = False
                user_id = False
                
                # Récupérer case_id depuis caisse_id
                if month.caisse_id:
                    case_id = month.caisse_id.id
                    
                    # Récupérer user_id depuis l'employé de la caisse
                    if month.caisse_id.employee_id and month.caisse_id.employee_id.user_id:
                        user_id = month.caisse_id.employee_id.user_id.id
                
                # Fallback: utiliser l'utilisateur actuel
                if not user_id:
                    user_id = self.env.user.id
                
                if not case_id:
                    _logger.warning(
                        f"⚠️ WebSocket Month: case_id manquant pour month {month.id}"
                    )
                    continue
                
                # Construire le canal privé
                channel = f"geo_lambert_expense_month_caisse_{case_id}_{user_id}"
                
                # Préparer le payload
                payload = month._prepare_month_payload()
                payload['event_type'] = event_type
                
                # Émettre via ws.notifier
                self.env["ws.notifier"].send(channel, payload)
                
                _logger.info(
                    f"✅ WebSocket Month émis: {channel} - "
                    f"event={event_type}, month_id={month.id}"
                )
                
                # ✅ AUSSI notifier le canal du compte parent pour synchronisation complète
                if month.caisse_id:
                    parent_channel = f"geo_lambert_expense_account_{case_id}_{user_id}"
                    
                    # Préparer le payload du compte parent complet
                    account_payload = month.caisse_id._prepare_account_payload() if hasattr(month.caisse_id, '_prepare_account_payload') else {
                        'id': month.caisse_id.id,
                        'name': month.caisse_id.name,
                        'display_name': month.caisse_id.display_name,
                        'month_ids': []  # Will be filled by the account method
                    }
                    account_payload['event_type'] = 'child_updated'
                    account_payload['updated_month_id'] = month.id
                    
                    self.env["ws.notifier"].send(parent_channel, account_payload)
                    
                    _logger.info(
                        f"✅ WebSocket Account Parent notifié: {parent_channel} - "
                        f"month_id={month.id}"
                    )
                
            except Exception as e:
                _logger.error(
                    f"❌ Erreur émission WebSocket Month pour {month.id}: {str(e)}",
                    exc_info=True
                )
                continue

    @api.model_create_multi
    def create(self, vals_list):
        """Override create pour envoyer une notification WebSocket"""
        records = super(HrExpenseAccountMonth, self).create(vals_list)
        
        for record in records:
            record._send_month_notification(event_type='created')
            
            # Notifier aussi le compte parent
            if record.caisse_id:
                record.caisse_id._send_account_notification(event_type='updated')
        
        return records

    def write(self, vals):
        """Override write pour envoyer une notification WebSocket"""
        # Sauvegarder les anciennes caisses avant modification
        old_caisses = self.mapped('caisse_id')
        
        result = super(HrExpenseAccountMonth, self).write(vals)
        
        # Récupérer les nouvelles caisses
        new_caisses = self.mapped('caisse_id')
        
        # Envoyer notification pour chaque mois modifié
        for record in self:
            record._send_month_notification(event_type='updated')
        
        # Notifier toutes les caisses concernées (anciennes et nouvelles)
        all_caisses = old_caisses | new_caisses
        for caisse in all_caisses:
            if caisse and caisse.exists():
                caisse._send_account_notification(event_type='updated')
        
        return result

    def unlink(self):
        """Override unlink pour envoyer une notification WebSocket avant suppression"""
        # Sauvegarder les infos AVANT suppression
        month_info = []
        caisses_to_notify = self.mapped('caisse_id').filtered(lambda c: c.exists())
        
        for month in self:
            case_id = False
            user_id = False
            
            if month.caisse_id:
                case_id = month.caisse_id.id
                if month.caisse_id.employee_id and month.caisse_id.employee_id.user_id:
                    user_id = month.caisse_id.employee_id.user_id.id
            
            if not user_id:
                user_id = self.env.user.id
            
            if case_id:
                month_info.append({
                    'id': month.id,
                    'case_id': case_id,
                    'user_id': user_id,
                    'name': month.name or '',
                    'display_name': month.display_name or '',
                })
        
        # Supprimer les mois
        result = super(HrExpenseAccountMonth, self).unlink()
        
        # Émettre les notifications après suppression
        for info in month_info:
            try:
                channel = f"geo_lambert_expense_month_caisse_{info['case_id']}_{info['user_id']}"
                payload = {
                    'event_type': 'deleted',
                    'id': info['id'],
                    'name': info['name'],
                    'display_name': info['display_name'],
                }
                self.env["ws.notifier"].send(channel, payload)
                _logger.info(
                    f"✅ WebSocket Month émis (deleted): {channel} - month_id={info['id']}"
                )
            except Exception as e:
                _logger.error(
                    f"❌ Erreur émission WebSocket Month (deleted) pour {info['id']}: {str(e)}"
                )
        
        # Notifier les caisses après suppression
        for caisse in caisses_to_notify:
            if caisse.exists():
                caisse._send_account_notification(event_type='updated')
        
        return result
