{
    'name': 'WebSocket Integration',
    'version': '18.0.1.0.0',
    'category': 'Technical',
    'summary': 'Simple WebSocket configuration and testing interface',
    'description': """
    WebSocket Configuration Module
    ==============================
    
    Simple WebSocket integration with configuration interface.
    
    Features:
    * WebSocket gateway configuration
    * Connection testing and health checks
    * Debug mode and logging
    * Authentication token support
    * Real-time notification sending
    """,
    'author': 'Ayoub Ezzine',
    'website': 'https://github.com/ayoubezzine',
    'license': 'LGPL-3',
    'depends': [
        'base',
        'web',
    ],
    'external_dependencies': {
        'python': ['requests'],
    },
    'data': [
        'security/websocket_security.xml',
        'security/ir.model.access.csv',
        'views/websocket_menu.xml',
        'views/ws_notifier_views.xml',
    ],
    'installable': True,
    'auto_install': False,
    'application': True,
    'sequence': 100,
    'images': ['static/description/icon.png'],
}
