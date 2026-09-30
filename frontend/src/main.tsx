import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './app/App';
import './tokens.css';
import './styles.css';
import './app/portal.css';
import './app/ui.css';
import './pages/home.css';
import './features/duty-ops/duty-page.css';
import './features/flightlogger/credentials.css';
import { applyTheme, watchSystemTheme } from './app/theme';

applyTheme();
watchSystemTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(<BrowserRouter><App /></BrowserRouter>);
