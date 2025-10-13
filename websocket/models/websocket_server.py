import requests
from odoo import models, api, fields
import json
from datetime import datetime
import logging

_logger = logging.getLogger(__name__)

class WsNotifier(models.Model):
    _name = "ws.notifier"
    _description = "WebSocket Global Configuration and Notifier"
    _rec_name = "display_name"
    
    # Fields for the UI
    display_name = fields.Char(string="Configuration Name", default="WebSocket Configuration", readonly=True)
    gateway_url = fields.Char(string="Gateway URL", compute="_compute_config_fields", inverse="_inverse_gateway_url")
    timeout = fields.Integer(string="Timeout (seconds)", compute="_compute_config_fields", inverse="_inverse_timeout")
    enabled = fields.Boolean(string="Enabled", compute="_compute_config_fields", inverse="_inverse_enabled")
    retry_attempts = fields.Integer(string="Retry Attempts", compute="_compute_config_fields", inverse="_inverse_retry_attempts")
    debug_mode = fields.Boolean(string="Debug Mode", compute="_compute_config_fields", inverse="_inverse_debug_mode")
    auth_token = fields.Char(string="Auth Token", compute="_compute_config_fields", inverse="_inverse_auth_token")
    
    # Status fields
    connection_status = fields.Selection([
        ('connected', 'Connected'),
        ('disconnected', 'Disconnected'),
        ('error', 'Error'),
        ('unknown', 'Unknown')
    ], string="Connection Status", default='unknown', compute="_compute_connection_status")
    
    last_health_check = fields.Datetime(string="Last Health Check", compute="_compute_status_fields")
    last_error = fields.Text(string="Last Error", compute="_compute_status_fields")
    
    # UI fields
    test_message = fields.Char(string="Test Message", default="Test message from Odoo")
    test_channel = fields.Char(string="Test Channel", default="message_app_geo_lambert")
    config_history = fields.Text(string="Configuration History", compute="_compute_config_history")
    
    # Configuration globale par défaut
    DEFAULT_CONFIG = {
        'websocket.gateway_url': 'https://websocket.daisyconsulting.ma/websocket',
        'websocket.timeout': '10',
        'websocket.enabled': 'True',
        'websocket.retry_attempts': '3',
        'websocket.debug_mode': 'False',
        'websocket.auth_token': '',
    }
    
    @api.model
    def _get_config_parameter(self, key, default=None):
        """Récupérer un paramètre de configuration global"""
        IrConfig = self.env['ir.config_parameter'].sudo()
        value = IrConfig.get_param(key, default)
        return value
    
    @api.model
    def _set_config_parameter(self, key, value):
        """Définir un paramètre de configuration global"""
        IrConfig = self.env['ir.config_parameter'].sudo()
        IrConfig.set_param(key, value)
        return True

    @api.model
    def send(self, channel, payload):
        """
        Service générique: تعطيه channel + payload وهو يتكلف
        Example:
            self.env['ws.notifier'].send("my_channel", {"msg": "salam"})
        """
        ws = self.env["ws.notifier"].get_websocket_singleton()
        if not ws:
            _logger.error("❌ Impossible d'envoyer: pas de configuration WebSocket")
            return {"status": "error", "message": "Pas de configuration WebSocket"}

        payload_with_meta = {
            **payload,
            "timestamp": datetime.now().isoformat(),
            "source": "odoo_service"
        }

        success = ws.send_to_gateway(channel, payload_with_meta)

        if success:
            _logger.info(f"✅ Message envoyé via channel '{channel}': {payload_with_meta}")
            return {"status": "success", "channel": channel, "data": payload_with_meta}
        else:
            _logger.error(f"❌ Échec envoi via channel '{channel}'")
            return {"status": "error", "message": "Envoi échoué", "channel": channel}
    
    @api.model
    def _initialize_default_config(self):
        """Initialiser la configuration par défaut si elle n'existe pas"""
        for key, default_value in self.DEFAULT_CONFIG.items():
            existing_value = self._get_config_parameter(key)
            if not existing_value:
                self._set_config_parameter(key, default_value)
                _logger.info(f"Initialized config: {key} = {default_value}")
    
    @api.model
    def get_websocket_config(self):
        """Récupérer toute la configuration WebSocket"""
        self._initialize_default_config()
        config = {}
        for key in self.DEFAULT_CONFIG.keys():
            config[key.replace('websocket.', '')] = self._get_config_parameter(key)
        return config

    def send_to_gateway(self, channel, data):
        """Envoyer des données au gateway WebSocket en utilisant la configuration globale"""
        try:
            # Récupérer la configuration globale
            config = self.get_websocket_config()
            
            # Vérifier si WebSocket est activé
            if config.get('enabled', 'True').lower() != 'true':
                _logger.warning("WebSocket est désactivé dans la configuration globale")
                return False
            
            # Préparer le payload avec channel et data
            payload = {
                "channel": channel,
                "data": data,
                "token": self.auth_token,
                "timestamp": datetime.now().isoformat(),
                "source": "odoo_server"
            }
            
            # Préparer les headers
            headers = {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "true"
            }
            
            # Ajouter le token d'authentification si configuré
            auth_token = config.get('auth_token', '')
            if auth_token:
                headers["Authorization"] = f"Bearer {auth_token}"
            
            # Récupérer les paramètres de configuration
            gateway_url = config.get('gateway_url', self.DEFAULT_CONFIG['websocket.gateway_url'])
            timeout = int(config.get('timeout', self.DEFAULT_CONFIG['websocket.timeout']))
            debug_mode = config.get('debug_mode', 'False').lower() == 'true'
            
            if debug_mode:
                _logger.info(f"🔧 WebSocket Config: URL={gateway_url}, Timeout={timeout}s")
                _logger.info(f"📤 Sending to gateway - Channel: {channel}, Payload: {payload}")
            
            # Envoyer la requête POST
            response = requests.post(
                gateway_url,
                json=payload,
                headers=headers,
                timeout=timeout
            )
            
            if debug_mode:
                _logger.info(f"📥 Gateway response - Status: {response.status_code}, Response: {response.text}")
            
            return response.status_code == 200
            
        except requests.RequestException as e:
            _logger.error(f"❌ Erreur lors de l'envoi au gateway: {e}")
            return False
        except Exception as e:
            _logger.error(f"❌ Erreur inattendue lors de l'envoi au gateway: {e}")
            return False

    @api.model
    def enable_websocket(self, enabled=True):
        """Activer/désactiver le WebSocket globalement"""
        self._set_config_parameter('websocket.enabled', str(enabled))
        status = "activé" if enabled else "désactivé"
        _logger.info(f"🔄 WebSocket {status} globalement")
        return {"status": "success", "message": f"WebSocket {status}"}

    # Compute methods for UI fields
    @api.depends()
    def _compute_config_fields(self):
        """Compute configuration fields from system parameters"""
        for record in self:
            config = record.get_websocket_config()
            record.gateway_url = config.get('gateway_url', '')
            record.timeout = int(config.get('timeout', '10'))
            record.enabled = config.get('enabled', 'False').lower() == 'true'
            record.retry_attempts = int(config.get('retry_attempts', '3'))
            record.debug_mode = config.get('debug_mode', 'False').lower() == 'true'
            record.auth_token = config.get('auth_token', '')
    
    def _inverse_gateway_url(self):
        """Set gateway URL in system parameters"""
        for record in self:
            record._set_config_parameter('websocket.gateway_url', record.gateway_url or '')
    
    def _inverse_timeout(self):
        """Set timeout in system parameters"""
        for record in self:
            record._set_config_parameter('websocket.timeout', str(record.timeout or 10))
    
    def _inverse_enabled(self):
        """Set enabled status in system parameters"""
        for record in self:
            record._set_config_parameter('websocket.enabled', str(record.enabled))
    
    def _inverse_retry_attempts(self):
        """Set retry attempts in system parameters"""
        for record in self:
            record._set_config_parameter('websocket.retry_attempts', str(record.retry_attempts or 3))
    
    def _inverse_debug_mode(self):
        """Set debug mode in system parameters"""
        for record in self:
            record._set_config_parameter('websocket.debug_mode', str(record.debug_mode))
    
    def _inverse_auth_token(self):
        """Set auth token in system parameters"""
        for record in self:
            record._set_config_parameter('websocket.auth_token', record.auth_token or '')
    
    @api.depends()
    def _compute_connection_status(self):
        """Compute connection status based on last health check"""
        for record in self:
            try:
                # Try a quick connection test
                config = record.get_websocket_config()
                if not config.get('enabled', 'False').lower() == 'true':
                    record.connection_status = 'disconnected'
                else:
                    # This is a simplified status check - in production you might want
                    # to cache this or use a different approach
                    record.connection_status = 'unknown'
            except:
                record.connection_status = 'error'
    
    @api.depends()
    def _compute_status_fields(self):
        """Compute status fields"""
        for record in self:
            # Get last health check from system parameters or logs
            last_check = record._get_config_parameter('websocket.last_health_check')
            if last_check:
                try:
                    record.last_health_check = datetime.fromisoformat(last_check.replace('Z', '+00:00'))
                except:
                    record.last_health_check = False
            else:
                record.last_health_check = False
            
            # Get last error
            record.last_error = record._get_config_parameter('websocket.last_error', '')
    
    @api.depends()
    def _compute_config_history(self):
        """Compute configuration history"""
        for record in self:
            config = record.get_websocket_config()
            history_text = "Current Configuration:\n"
            for key, value in config.items():
                # Mask sensitive information
                if key == 'auth_token' and value:
                    value = '***masked***'
                history_text += f"- {key}: {value}\n"
            record.config_history = history_text

    # Override methods to work with UI
    def test_websocket_connection(self):
        """Instance method to work with form view - delegates to model method"""
        self.ensure_one()
        # Call the model-level method (without super())
        test_data = {
            "type": "test_from_odoo",
            "content": self.test_message or "Test de connexion depuis Odoo",
            "timestamp": datetime.now().isoformat(),
            "source": "odoo_server"
        }
        success = self.send_to_gateway(self.test_channel or "message_app_geo_lambert", test_data)
        _logger.info(f"ayoub success {success}")

        if success:
            _logger.info("✅ Test WebSocket réussi - Message envoyé avec succès")
            result = {"status": "success", "message": "Test WebSocket réussi"}
        else:
            _logger.info("❌ Test WebSocket échoué - Impossible d'envoyer le message")
            result = {"status": "error", "message": "Test WebSocket échoué"}

        # Store result in system parameters for status display
        self._set_config_parameter('websocket.last_health_check', datetime.now().isoformat())
        if result.get('status') == 'success':
            self._set_config_parameter('websocket.last_error', '')
        else:
            self._set_config_parameter('websocket.last_error', result.get('message', 'Unknown error'))
        return result


    def reset_to_default_config(self):
        """Instance method to reset configuration to defaults (for form view button)"""
        self.ensure_one()
        
        # Reset configuration using the same logic as the model method
        reset_config = {}
        for key, default_value in self.DEFAULT_CONFIG.items():
            param_name = key.replace('websocket.', '')
            self._set_config_parameter(key, default_value)
            reset_config[param_name] = default_value
            _logger.info(f"Reset {param_name} to: {default_value}")
        
        _logger.info("✅ Configuration WebSocket remise aux valeurs par défaut")
        return {"status": "success", "message": "Configuration reset to defaults", "config": reset_config}
    
    def toggle_websocket(self):
        """Toggle WebSocket enabled status"""
        self.ensure_one()
        current_status = self.enabled
        self.enabled = not current_status
        return self.enable_websocket(self.enabled)
    
    @api.model
    def create(self, vals):
        """Override create to ensure singleton"""
        existing = self.search([])
        if existing:
            return existing[0]
        return super().create(vals)
    
    @api.model
    def get_websocket_singleton(self):
        """Get or create the WebSocket configuration singleton"""
        config = self.search([], limit=1)
        if not config:
            config = self.create({'display_name': 'WebSocket Configuration'})
        return config
