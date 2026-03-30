const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('http://localhost:8080');
    // Check if Chess3D is defined
    const hasChess3D = await page.evaluate(() => typeof Chess3D !== 'undefined');
    console.log("hasChess3D:", hasChess3D);
    
    // Check toggle
    await page.evaluate(() => {
        document.getElementById('view-select').value = '3d';
        document.getElementById('view-select').dispatchEvent(new Event('change'));
    });
    
    // Check board visibility
    const boardHidden = await page.evaluate(() => document.getElementById('board').classList.contains('hidden'));
    const p3dHidden = await page.evaluate(() => document.getElementById('board-3d-container').classList.contains('hidden'));
    const p3dCanvas = await page.evaluate(() => document.querySelector('#board-3d-container canvas') !== null);
    
    console.log("boardHidden:", boardHidden);
    console.log("p3dHidden:", p3dHidden);
    console.log("p3dCanvas:", p3dCanvas);
    console.log("Errors:", await page.evaluate(() => window.errors || []));
    
    await browser.close();
})();
