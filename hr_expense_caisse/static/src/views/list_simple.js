/** @odoo-module */

import { registry } from '@web/core/registry';
import { listView } from "@web/views/list/list_view";
import { ListRenderer } from "@web/views/list/list_renderer";
import { ListController } from "@web/views/list/list_controller";
import { useService } from '@web/core/utils/hooks';
import { onMounted, onWillUnmount } from "@odoo/owl";

import { ExpenseDashboardSimple } from '../components/expense_dashboard_simple';

export class ExpenseDashboardListRendererSimple extends ListRenderer {
  static components = { ...ListRenderer.components, ExpenseDashboardSimple };
  static template = 'hr_expense_caisse.DashboardListRendererSimple';
  
  setup() {
    super.setup();
    // console.log('🛠️ Setup ExpenseDashboardListRendererSimple');
    
    this.notification = useService('notification');
    this.orm = useService('orm');
    
    onMounted(() => {
      // console.log('📌 Renderer Simple monté');
    });
    
    onWillUnmount(() => {
      // console.log('📌 Renderer Simple démonté');
    });
  }
}

export class ExpenseDashboardListControllerSimple extends ListController {
  setup() {
    super.setup();
    // console.log('🛠️ Setup Controller Simple');
    this.notification = useService('notification');
  }
}

// Enregistrement de la vue
registry.category('views').add('expense_spending_dashboard_tree_simple', {
  ...listView,
  Renderer: ExpenseDashboardListRendererSimple,
  Controller: ExpenseDashboardListControllerSimple,
});

// console.log('✅ Vue SIMPLE enregistrée');
