$ErrorActionPreference = 'Stop'

$base = 'http://127.0.0.1:8090'
$adminCreds = @{ phone = '+998901234567'; password = '0000' }
$cashierCreds = @{ phone = '+998901234568'; password = '1234' }

function Invoke-Json {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST', 'PUT', 'DELETE')]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [hashtable]$Headers,
    [object]$Body
  )

  $params = @{
    Method = $Method
    Uri = $Uri
  }

  if ($Headers) {
    $params.Headers = $Headers
  }

  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = ($Body | ConvertTo-Json -Depth 12)
  }

  Write-Host "[$Method] $Uri"
  Invoke-RestMethod @params
}

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

$adminLogin = Invoke-Json -Method POST -Uri "$base/api/login" -Body $adminCreds
Assert-True ([bool]$adminLogin.token) 'Admin login failed'

$cashierLogin = Invoke-Json -Method POST -Uri "$base/api/login" -Body $cashierCreds
Assert-True ([bool]$cashierLogin.token) 'Cashier login failed'

$adminToken = $adminLogin.token
$cashierToken = $cashierLogin.token

$shops = Invoke-Json -Method GET -Uri "$base/api/shops" -Headers @{ Authorization = "Bearer $adminToken" }
$targetShop = $shops | Where-Object { $_.name -eq 'Test Shop 2' } | Select-Object -First 1
if (-not $targetShop) {
  $targetShop = $shops | Select-Object -First 1
}
Assert-True ([bool]($targetShop -ne $null)) 'No shop found for testing'

$targetWarehouseId = $targetShop.warehouseId._id
Assert-True ([bool]$targetWarehouseId) 'Target warehouseId missing'

$createdProducts = @()
for ($i = 1; $i -le 10; $i++) {
  $productBody = @{
    name          = "Smoke Product $i"
    model         = "SP-$i"
    baseUnit      = 'dona'
    purchasePrice = 100 + $i
    sellPrice     = 150 + $i
    hasPackage    = $false
  }

  $created = Invoke-Json -Method POST -Uri "$base/api/products" -Headers @{ Authorization = "Bearer $adminToken" } -Body $productBody
  Assert-True ([bool]$created.product._id) "Product $i creation failed"
  $createdProducts += [pscustomobject]@{
    id            = $created.product._id
    name          = $created.product.name
    barcode       = $created.product.barcode
    purchasePrice = [double]$productBody.purchasePrice
    sellPrice     = [double]$productBody.sellPrice
  }
}

$supplierBody = @{
  name    = 'Smoke Supplier'
  address = 'Smoke Address'
  note    = 'Full smoke test'
}

$purchaseItems = @()
foreach ($p in $createdProducts) {
  $purchaseItems += @{
    productId     = $p.id
    inputType     = 'unit'
    inputQuantity  = 100
    purchasePrice  = $p.purchasePrice
    sellPrice      = $p.sellPrice
    barcode        = $p.barcode
  }
}

$purchase = Invoke-Json -Method POST -Uri "$base/api/purchase" -Headers @{ Authorization = "Bearer $adminToken" } -Body @{
  warehouseId  = $targetWarehouseId
  supplier     = $supplierBody
  paymentType  = 'cash'
  items        = $purchaseItems
}
Assert-True ([bool]$purchase.purchase._id) 'Purchase creation failed'

$stockAfterPurchase = Invoke-Json -Method GET -Uri "$base/api/$targetWarehouseId/stock" -Headers @{ Authorization = "Bearer $adminToken" }
Assert-True ($stockAfterPurchase.totalProducts -ge 10) 'Expected at least 10 stock rows after purchase'

$saleItems = @()
foreach ($p in $createdProducts) {
  $saleItems += @{
    productId    = $p.id
    inputType    = 'unit'
    inputQuantity = 5
    unitSellPrice = $p.sellPrice
  }
}

$sale = Invoke-Json -Method POST -Uri "$base/api/sales" -Headers @{ Authorization = "Bearer $cashierToken" } -Body @{
  items       = $saleItems
  paymentType = 'cash'
}
Assert-True ([bool]$sale.sale._id) 'Sale creation failed'

$saleReturnItems = @()
foreach ($item in $sale.sale.items) {
  $saleReturnItems += @{
    productId     = $item.productId
    returnQuantity = 2
  }
}

$saleReturn = Invoke-Json -Method POST -Uri "$base/api/sales/returns" -Headers @{ Authorization = "Bearer $cashierToken" } -Body @{
  saleId      = $sale.sale._id
  items       = $saleReturnItems
  refundType  = 'cash'
  reason      = 'Smoke return'
}
Assert-True ([bool]$saleReturn.saleReturn._id) 'Sale return creation failed'

$finalStock = Invoke-Json -Method GET -Uri "$base/api/$targetWarehouseId/stock" -Headers @{ Authorization = "Bearer $adminToken" }

$expectedQuantity = 97
$mismatches = @()
foreach ($p in $createdProducts) {
  $row = $finalStock.data | Where-Object { $_.productId._id -eq $p.id } | Select-Object -First 1
  if (-not $row) {
    $mismatches += "Missing stock row for $($p.name)"
    continue
  }

  if ([int]$row.quantity -ne $expectedQuantity) {
    $mismatches += "$($p.name): expected $expectedQuantity, got $($row.quantity)"
  }
}

Assert-True ([bool]($mismatches.Count -eq 0)) ("Stock mismatch: " + ($mismatches -join '; '))

$summary = [pscustomobject]@{
  shop = $targetShop.name
  warehouseId = $targetWarehouseId
  productsCreated = $createdProducts.Count
  purchaseId = $purchase.purchase._id
  saleId = $sale.sale._id
  saleReturnId = $saleReturn.saleReturn._id
  finalQuantityPerProduct = $expectedQuantity
}

$summary | ConvertTo-Json -Depth 8
