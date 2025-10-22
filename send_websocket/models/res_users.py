from odoo import models, api
import logging

_logger = logging.getLogger(__name__)


class ResUsers(models.Model):
    _inherit = 'res.users'

    def _prepare_user_payload(self):
        """
        Prépare le payload pour la notification WebSocket de l'utilisateur
        """
        self.ensure_one()
        
        # Récupérer les informations de l'employé associé
        employee = self.employee_id if hasattr(self, 'employee_id') else False
        
        # Récupérer le case_id depuis l'employé ou le compte de dépenses
        case_id = False
        balance = 0.0
        
        if employee:
            # Chercher le compte de dépenses associé à l'employé
            expense_account = self.env['hr.expense.account'].search([
                ('employee_id', '=', employee.id)
            ], limit=1)
            
            if expense_account:
                case_id = expense_account.id
                balance = expense_account.balance if hasattr(expense_account, 'balance') else 0.0
        
        # Construire le payload complet
        return {
            'id': self.id,
            'uid': self.id,  # Pour compatibilité
            'name': self.name,
            'login': self.login,
            'email': self.email or '',
            'display_name': self.display_name or self.name,
            'user_name': self.name,
            'user_login': self.login,
            'username': self.login,
            
            # Informations de l'employé
            'employee_id': str(employee.id) if employee else False,
            'case_id': case_id,
            'balance': balance,
            
            # Informations du partenaire
            'partner_id': self.partner_id.id if self.partner_id else False,
            'partner_name': self.partner_id.name if self.partner_id else '',
            'phone': self.partner_id.phone if self.partner_id else '',
            'mobile': self.partner_id.mobile if self.partner_id else '',
            'street': self.partner_id.street if self.partner_id else '',
            'street2': self.partner_id.street2 if self.partner_id else '',
            'city': self.partner_id.city if self.partner_id else '',
            'state_id': self.partner_id.state_id.name if self.partner_id and self.partner_id.state_id else '',
            'country_id': self.partner_id.country_id.name if self.partner_id and self.partner_id.country_id else '',
            'zip': self.partner_id.zip if self.partner_id else '',
            
            # Informations de la société
            'company_id': self.company_id.id if self.company_id else False,
            'company_name': self.company_id.name if self.company_id else '',
            'is_company': self.partner_id.is_company if self.partner_id else False,
            
            # Autres informations
            'function': self.partner_id.function if self.partner_id else '',
            'title': self.partner_id.title.name if self.partner_id and self.partner_id.title else '',
            'lang': self.lang if self.lang else 'fr_FR',
            'tz': self.tz if self.tz else 'Europe/Paris',
            'active': self.active,
            
            # Permissions
            'is_admin': self.has_group('base.group_system'),
            'groups': [g.full_name for g in self.groups_id] if self.groups_id else [],
            
            # Image et signature
            'image_url': f"/web/image/res.users/{self.id}/avatar_128" if self.id else '',
            'signature': self.signature if hasattr(self, 'signature') and self.signature else '',
            
            # Dates
            'create_date': self.create_date.isoformat() if self.create_date else False,
            'login_date': self.login_date.isoformat() if hasattr(self, 'login_date') and self.login_date else False,
            'write_date': self.write_date.isoformat() if self.write_date else False,
            
            # Notification
            'notification_type': self.notification_type if hasattr(self, 'notification_type') else 'email',
        }

    def _send_user_auth_notification(self, event_type='updated'):
        """
        Envoie une notification WebSocket pour les changements du profil utilisateur
        Canal privé: geo_lambert_res_users_id_{user_id}
        """
        for user in self:
            try:
                # Construire le canal privé
                channel = f"geo_lambert_res_users_id_{user.id}"
                
                # Préparer le payload
                payload = user._prepare_user_payload()
                payload['event_type'] = event_type
                
                # Émettre via ws.notifier
                self.env["ws.notifier"].send(channel, payload)
                
                _logger.info(
                    f"✅ WebSocket User Auth émis: {channel} - "
                    f"event={event_type}, user_id={user.id}, display_name={user.display_name}"
                )
                
            except Exception as e:
                _logger.error(
                    f"❌ Erreur émission WebSocket User Auth pour {user.id}: {str(e)}",
                    exc_info=True
                )
                continue

    def write(self, vals):
        """Override write pour envoyer une notification WebSocket"""
        # Sauvegarder les anciennes valeurs importantes
        old_values = {}
        for user in self:
            old_values[user.id] = {
                'balance': 0.0,
                'case_id': False
            }
            
            # Récupérer l'ancienne balance si possible
            if user.employee_id:
                expense_account = self.env['hr.expense.account'].search([
                    ('employee_id', '=', user.employee_id.id)
                ], limit=1)
                if expense_account:
                    old_values[user.id]['balance'] = expense_account.balance if hasattr(expense_account, 'balance') else 0.0
                    old_values[user.id]['case_id'] = expense_account.id
        
        # Effectuer la modification
        result = super(ResUsers, self).write(vals)
        
        # Envoyer notification pour chaque utilisateur modifié
        for user in self:
            # Détecter si des champs importants ont changé
            fields_to_monitor = ['name', 'email', 'lang', 'tz', 'active', 'notification_type', 'signature']
            important_change = any(field in vals for field in fields_to_monitor)
            
            # Vérifier aussi les changements du partenaire associé
            if 'partner_id' in vals or (user.partner_id and any(field in vals for field in ['phone', 'mobile', 'street', 'city', 'country_id'])):
                important_change = True
            
            # Envoyer la notification
            user._send_user_auth_notification(event_type='updated')
            
            # Log si changement important
            if important_change:
                _logger.info(f"📝 Changement important détecté pour user {user.id}: {list(vals.keys())}")
        
        return result

    @api.model_create_multi
    def create(self, vals_list):
        """Override create pour envoyer une notification WebSocket"""
        records = super(ResUsers, self).create(vals_list)
        
        for record in records:
            record._send_user_auth_notification(event_type='created')
        
        return records

    def unlink(self):
        """Override unlink pour envoyer une notification WebSocket avant suppression"""
        # Sauvegarder les infos AVANT suppression
        user_info = []
        for user in self:
            user_info.append({
                'id': user.id,
                'name': user.name or '',
                'display_name': user.display_name or '',
                'login': user.login,
            })
        
        # Supprimer les utilisateurs
        result = super(ResUsers, self).unlink()
        
        # Émettre les notifications après suppression
        for info in user_info:
            try:
                channel = f"geo_lambert_res_users_id_{info['id']}"
                payload = {
                    'event_type': 'deleted',
                    'id': info['id'],
                    'name': info['name'],
                    'display_name': info['display_name'],
                    'login': info['login'],
                }
                self.env["ws.notifier"].send(channel, payload)
                _logger.info(
                    f"✅ WebSocket User Auth émis (deleted): {channel} - user_id={info['id']}"
                )
            except Exception as e:
                _logger.error(
                    f"❌ Erreur émission WebSocket User Auth (deleted) pour {info['id']}: {str(e)}"
                )
        
        return result


class ResPartner(models.Model):
    """
    Hérite res.partner pour capturer les changements de profil partenaire
    qui affectent les utilisateurs
    """
    _inherit = 'res.partner'
    
    def write(self, vals):
        """Override write pour notifier les changements de partenaire aux utilisateurs associés"""
        result = super(ResPartner, self).write(vals)
        
        # Trouver les utilisateurs associés à ces partenaires
        users = self.env['res.users'].search([('partner_id', 'in', self.ids)])
        
        # Si des utilisateurs sont trouvés et que des champs importants ont changé
        if users:
            important_fields = ['name', 'email', 'phone', 'mobile', 'street', 'street2', 
                              'city', 'state_id', 'country_id', 'zip', 'function', 
                              'title', 'is_company', 'image_1920']
            
            if any(field in vals for field in important_fields):
                # Notifier chaque utilisateur associé
                for user in users:
                    user._send_user_auth_notification(event_type='updated')
                    _logger.info(
                        f"📝 Partner {self.id} modifié - Notification envoyée à user {user.id}"
                    )
        
        return result


class HrEmployee(models.Model):
    """
    Hérite hr.employee pour capturer les changements d'employé
    qui affectent les utilisateurs (notamment le balance)
    """
    _inherit = 'hr.employee'
    
    def write(self, vals):
        """Override write pour notifier les changements d'employé aux utilisateurs associés"""
        result = super(HrEmployee, self).write(vals)
        
        # Trouver les utilisateurs associés à ces employés
        users = self.mapped('user_id').filtered(lambda u: u.exists())
        
        # Notifier chaque utilisateur associé
        for user in users:
            user._send_user_auth_notification(event_type='updated')
            _logger.info(
                f"📝 Employee {self.id} modifié - Notification envoyée à user {user.id}"
            )
        
        return result


# Extension du modèle hr.expense.account pour notifier les changements de balance
class HrExpenseAccountExtended(models.Model):
    """
    Étend hr.expense.account pour notifier les changements de balance
    à l'utilisateur associé
    """
    _inherit = 'hr.expense.account'
    
    def write(self, vals):
        """Override write pour notifier les changements de balance"""
        # Sauvegarder les anciennes balances
        old_balances = {account.id: account.balance if hasattr(account, 'balance') else 0.0 
                       for account in self}
        
        result = super(HrExpenseAccountExtended, self).write(vals)
        
        # Vérifier si la balance a changé et notifier l'utilisateur
        for account in self:
            new_balance = account.balance if hasattr(account, 'balance') else 0.0
            old_balance = old_balances.get(account.id, 0.0)
            
            # Si la balance a changé, notifier l'utilisateur
            if new_balance != old_balance:
                if account.employee_id and account.employee_id.user_id:
                    user = account.employee_id.user_id
                    user._send_user_auth_notification(event_type='updated')
                    _logger.info(
                        f"💰 Balance changée pour account {account.id}: "
                        f"{old_balance} -> {new_balance} - "
                        f"Notification envoyée à user {user.id}"
                    )
        
        return result
